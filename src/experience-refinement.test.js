import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizeSettings, settingsError } from './settings.js';
import { normalizeData, applyOperation } from './data-model.js';
import { currentCalculation, workAction } from './work-log.js';
import { calculateSchedule } from './schedule.js';
import { needsSetup, shiftExperience } from './experience-state.js';
import { setupPatch } from './onboarding.js';
import { createPreviewStore } from './widget-preview.js';
import { CHINA_CALENDAR } from './china-calendar.js';
import { previewAppearance } from './appearance-preview.js';

const day = time => new Date(`2026-10-09T${time}`);
const settings = { ...structuredClone(defaults), setupComplete: true, dailySalary: 200, trackingMode: 'actual' };

test('only genuinely new profiles need salary confirmation; older settings migrate', () => {
  assert.equal(needsSetup(normalizeData()), true);
  const old = { ...settings };
  delete old.setupComplete;
  assert.equal(needsSetup(normalizeData({ settings: old })), false);
  assert.equal(normalizeSettings(old).setupComplete, true);
  assert.equal(normalizeSettings({ ...old, setupComplete: false }).setupComplete, false);
  assert.match(settingsError({ ...settings, setupComplete: 'yes' }), /配置状态/);
});

test('existing records bypass onboarding without modifying their salary snapshot', () => {
  const records = workAction([], settings, 'start', day('09:00:00'));
  const data = normalizeData({ settings: { ...settings, setupComplete: false }, records });
  assert.equal(needsSetup(data), false);
  assert.deepEqual(data.records, records);
});

test('legacy configuration imports remain configured, but empty profiles do not', () => {
  const imported = { ...settings };
  delete imported.setupComplete;
  const next = applyOperation(normalizeData(), { type: 'import-settings', settings: imported });
  assert.equal(needsSetup(next), false);
});

function setupForm(overrides = {}) {
  const form = new FormData();
  const values = { dailySalary: '200', start: '09:00', end: '18:00', workCalendar: CHINA_CALENDAR, trackingMode: 'actual', workday: '1', hasBreak: 'on', restStart: '12:00', restEnd: '13:00', ...overrides };
  Object.entries(values).forEach(([key, value]) => { if (value !== null) form.set(key, value); });
  return form;
}

test('setup requires an explicit salary, calendar choice and working day', () => {
  assert.throws(() => setupPatch(setupForm({ dailySalary: '' }), defaults), /日薪/);
  assert.throws(() => setupPatch(setupForm({ workCalendar: '' }), defaults), /调休/);
  assert.throws(() => setupPatch(setupForm({ workday: null }), defaults), /工作日/);
  const patch = setupPatch(setupForm(), defaults);
  assert.equal(patch.setupComplete, true);
  assert.equal(patch.workCalendar, CHINA_CALENDAR);
  assert.equal(patch.dailySalary, 200);
});

test('setup validates rest times and can explicitly omit a fixed break', () => {
  assert.throws(() => setupPatch(setupForm({ restEnd: '20:00' }), defaults), /休息/);
  assert.deepEqual(setupPatch(setupForm({ hasBreak: null }), defaults).breaks, []);
});

test('each temporary break has an independent elapsed duration and accrues no pay', () => {
  let records = workAction([], settings, 'start', day('09:00:00'));
  records = workAction(records, settings, 'break', day('10:00:00'));
  let result = currentCalculation(settings, records, day('10:03:10'));
  assert.equal(result.restSeconds, 190);
  assert.equal(result.worked, 3600);
  assert.equal(result.earned, 25);
  assert.equal(shiftExperience(result).restLabel, '本次休息');
  records = workAction(records, settings, 'resume', day('10:05:00'));
  assert.equal(currentCalculation(settings, records, day('10:06:00')).restSeconds, 0);
  records = workAction(records, settings, 'break', day('11:00:00'));
  result = currentCalculation(settings, records, day('11:00:10'));
  assert.equal(result.restSeconds, 10);
});

test('overtime rest crosses midnight but never goes negative after a clock rollback', () => {
  let records = workAction([], settings, 'overtime', day('23:40:00'));
  records = workAction(records, settings, 'break', day('23:59:00'));
  assert.equal(currentCalculation(settings, records, new Date('2026-10-10T00:01:00')).restSeconds, 120);
  assert.equal(currentCalculation(settings, records, day('23:58:00')).restSeconds, 0);
});

test('planned breaks use paid or unpaid captions and actual check-in bounds', () => {
  const paid = { ...settings, breaks: [{ start: '12:00', end: '13:00', paid: true }] };
  const estimate = calculateSchedule(paid, day('12:15:00'));
  assert.equal(estimate.restSeconds, 900);
  assert.equal(shiftExperience(estimate).restCaption, '有薪计划休息');
  const records = workAction([], paid, 'start', day('12:10:00'));
  assert.equal(currentCalculation(paid, records, day('12:15:00')).restSeconds, 300);
  assert.equal(currentCalculation(paid, records, day('18:05:00')).restSeconds, 0);
});

test('normal overnight work is not mislabeled as an overdue historical shift', () => {
  const overnight = { ...settings, start: '22:00', end: '06:00', breaks: [] };
  const records = workAction([], overnight, 'start', day('22:00:00'));
  const date = new Date('2026-10-10T02:00:00');
  assert.equal(shiftExperience(currentCalculation(overnight, records, date), date).historical, false);
  const overtime = workAction([], settings, 'overtime', day('20:00:00'));
  assert.equal(shiftExperience(currentCalculation(settings, overtime, date), date).historical, true);
});

test('schedule progress is independent of earned salary and hidden on rest days and overtime', () => {
  const records = workAction([], settings, 'start', day('16:00:00'));
  const result = currentCalculation(settings, records, day('16:00:00'));
  assert.equal(result.earned, 0);
  assert.ok(shiftExperience(result, day('16:00:00')).progress > 70);
  assert.equal(shiftExperience(calculateSchedule(settings, new Date('2026-10-11T16:00:00'))).showProgress, false);
  assert.equal(shiftExperience(currentCalculation(settings, workAction([], settings, 'overtime', day('19:00:00')), day('20:00:00'))).showProgress, false);
});

test('appearance preview has a separate store and never creates work records', async () => {
  const preview = createPreviewStore();
  await preview.init();
  await preview.dispatch({ type: 'settings', patch: { theme: 'night', widgetOpacity: 40 } });
  await preview.dispatch({ type: 'work', action: 'start' });
  assert.equal(preview.data.settings.theme, 'night');
  assert.equal(preview.data.settings.widgetOpacity, 40);
  assert.equal(preview.data.records.length, 0);
  assert.equal(preview.data.revision, 0);
  await assert.rejects(preview.dispatch({ type: 'settings', patch: { widgetOpacity: -1 } }));
});

test('appearance preview sends appearance only, never salary, schedules or history', () => {
  const patch = previewAppearance({ ...settings, theme: 'night', dailySalary: NaN, start: '' });
  assert.equal(patch.theme, 'night');
  assert.equal('dailySalary' in patch, false);
  assert.equal('start' in patch, false);
  assert.equal('setupComplete' in patch, false);
  assert.equal(settingsError({ ...defaults, ...patch }), '');
});
