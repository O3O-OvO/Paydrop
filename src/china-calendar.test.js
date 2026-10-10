import test from 'node:test';
import assert from 'node:assert/strict';
import { CHINA_CALENDAR, officialDay, resolveWorkday, lunarDate } from './china-calendar.js';
import { monthDays, moveMonth, validMonth } from './calendar-view.js';
import { defaults, normalizeSettings, validatePatch } from './settings.js';
import { calculateSchedule, shiftFor } from './schedule.js';
import { workAction, currentCalculation } from './work-log.js';
import { hasPendingPaySettings, paySettingsRows } from './work-status.js';
import { normalizeData, applyOperation } from './data-model.js';
import { backupEnvelope } from './record-management.js';

const plan = { ...defaults, workCalendar: CHINA_CALENDAR, dailySalary: 800, trackingMode: 'actual' };
const at = value => new Date(value);

test('official holiday and makeup totals match the two published annual notices', () => {
  for (const [year, holidays, makeup] of [[2025, 28, 5], [2026, 33, 6]]) {
    const days = Array.from({ length: 12 }, (_, month) => monthDays(`${year}-${String(month + 1).padStart(2, '0')}`, plan)).flat();
    assert.equal(days.filter(day => day.official.name && !day.official.working).length, holidays);
    assert.equal(days.filter(day => day.official.working).length, makeup);
    assert.ok(days.every(day => day.official.covered));
  }
});
test('all makeup dates override weekends and holiday endpoints are inclusive', () => {
  for (const key of ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
    '2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']) {
    assert.equal(resolveWorkday(plan, key).working, true, key);
    assert.equal(resolveWorkday(plan, key).source, 'official');
  }
  for (const key of ['2025-01-28', '2025-02-04', '2025-10-08', '2026-02-15', '2026-02-23', '2026-10-07']) {
    assert.equal(resolveWorkday(plan, key).working, false, key);
  }
  assert.equal(officialDay('2026-10-08').name, undefined);
});
test('manual exceptions win and disabling the calendar restores weekly rules', () => {
  assert.equal(resolveWorkday({ ...plan, exceptions: [{ date: '2026-10-10', working: false }] }, '2026-10-10').working, false);
  assert.equal(resolveWorkday({ ...plan, exceptions: [{ date: '2026-10-01', working: true }] }, '2026-10-01').working, true);
  assert.equal(resolveWorkday({ ...plan, workCalendar: 'weekly' }, '2026-10-10').working, false);
  assert.equal(resolveWorkday({ ...plan, workCalendar: 'weekly' }, '2026-10-01').working, true);
  assert.equal(resolveWorkday({ ...plan, workdays: [0] }, '2026-10-08').working, false);
});
test('unknown years are explicitly uncovered and do not invent holidays', () => {
  assert.equal(resolveWorkday(plan, '2027-01-01').source, 'fallback');
  assert.equal(resolveWorkday(plan, '2027-01-01').working, true);
  assert.equal(officialDay('2027-01-01').name, undefined);
  assert.equal(resolveWorkday({ ...plan, exceptions: [{ date: '2027-01-01', working: false }] }, '2027-01-01').source, 'manual');
});
test('old configurations and frozen records keep weekly semantics', () => {
  const old = structuredClone(defaults);
  delete old.workCalendar;
  assert.equal(normalizeSettings(old).workCalendar, 'weekly');
  assert.equal(hasPendingPaySettings(old, defaults), false);
  assert.equal(hasPendingPaySettings(old, plan), true);
  assert.equal(paySettingsRows(old, plan).find(row => row.label === '工作日历').changed, true);
  assert.throws(() => validatePatch(defaults, { workCalendar: 'unknown' }), /日历版本/);
});
test('holiday estimate stops earnings while makeup day supports ordinary check-in', () => {
  assert.equal(calculateSchedule(plan, at('2026-10-01T10:00:00')).earned, 0);
  assert.equal(calculateSchedule(plan, at('2026-10-10T10:00:00')).earned, 100);
  const records = workAction([], plan, 'start', at('2026-10-10T09:00:00'));
  const current = currentCalculation({ ...plan, workCalendar: 'weekly' }, records, at('2026-10-10T10:00:00'));
  assert.equal(current.earned, 100);
  assert.equal(current.calendarDay.label, '国庆节补班');
  assert.throws(() => workAction([], plan, 'start', at('2026-10-01T09:00:00')), /休息日/);
  const overtime = workAction([], plan, 'overtime', at('2026-10-01T09:00:00'));
  assert.equal(currentCalculation(plan, overtime, at('2026-10-01T10:00:00')).earned, 0);
});
test('overnight holiday rules use the shift start date, not the date after midnight', () => {
  const night = { ...plan, start: '22:00', end: '06:00', breaks: [] };
  const shift = shiftFor(night, at('2026-10-11T01:00:00'));
  assert.equal(shift.key, '2026-10-10');
  assert.equal(shift.isWorkday, true);
  assert.equal(shift.calendarDay.label, '国庆节补班');
  assert.equal(shiftFor(night, at('2026-10-08T01:00:00')).isWorkday, false);
});
test('calendar configuration persists in backup and changes do not rewrite salary snapshots', () => {
  const records = workAction([], plan, 'start', at('2026-10-10T09:00:00'));
  const before = normalizeData({ settings: plan, records });
  const changed = applyOperation(before, { type: 'settings', patch: { workCalendar: 'weekly' } }, at('2026-10-10T10:00:00'));
  assert.deepEqual(changed.records, records);
  const envelope = backupEnvelope(changed);
  assert.equal(envelope.data.settings.workCalendar, 'weekly');
  assert.equal(envelope.data.records[0].settings.workCalendar, CHINA_CALENDAR);
});
test('month navigation and lunar labels use local date-only values', () => {
  assert.equal(moveMonth('2026-12', 1), '2027-01');
  assert.equal(moveMonth('2026-01', -1), '2025-12');
  assert.equal(moveMonth('1900-01', -1), '1900-01');
  assert.equal(validMonth('2026-13'), false);
  assert.equal(monthDays('2024-02', plan).length, 29);
  assert.equal(monthDays('bad', plan).length, 0);
  assert.match(lunarDate('2026-02-17'), /正月/);
  assert.equal(lunarDate('2026-02-18'), '初二');
});
