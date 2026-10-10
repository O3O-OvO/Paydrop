import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings, settingsError } from './settings.js';
import { normalizeData, applyOperation } from './data-model.js';
import { calculateRecord, currentCalculation, workAction } from './work-log.js';
import { workPresentation, overtimeReminder, hasPendingPaySettings, paySettingsRows } from './work-status.js';

const settings = normalizeSettings({ dailySalary: 720, start: '09:00', end: '18:00', trackingMode: 'actual' });
const at = (hour, minute = 0, day = 5) => new Date(2026, 9, day, hour, minute);
const presentation = (records, date, plan = settings) => workPresentation(currentCalculation(plan, records, date));

test('unpaid overtime shows zero current pay and an increasing overtime timer', () => {
  const records = workAction([], settings, 'overtime', at(19));
  const result = presentation(records, at(20));
  assert.equal(result.rate, 0);
  assert.equal(result.rateLabel, '当前计薪');
  assert.equal(result.timerLabel, '已加班');
  assert.equal(result.timerSeconds, 3600);
  assert.equal(result.timerDirection, 'up');
  assert.match(result.timerCaption, /无薪加班/);
  assert.doesNotMatch(result.timerCaption, /已下班/);
});

test('paid overtime uses the recorded multiplier rather than later settings', () => {
  const paid = { ...settings, paidOvertime: true, overtimeMultiplier: 2 };
  const records = workAction([], paid, 'overtime', at(19));
  const result = presentation(records, at(20), { ...paid, dailySalary: 1440, overtimeMultiplier: 3 });
  assert.equal(result.rate, 0.05);
  assert.match(result.detail, /2 倍/);
  assert.equal(currentCalculation(paid, records, at(20)).earned, 180);
});

test('temporary overtime rest retains the overtime timer without accruing pay or time', () => {
  const paid = { ...settings, paidOvertime: true };
  let records = workAction([], paid, 'overtime', at(19));
  records = workAction(records, paid, 'break', at(20));
  const result = presentation(records, at(21), paid);
  assert.equal(result.rate, 0);
  assert.equal(result.timerLabel, '已加班');
  assert.equal(result.timerSeconds, 3600);
  assert.match(result.timerCaption, /临时休息/);
  records = workAction(records, paid, 'resume', at(21));
  assert.equal(presentation(records, at(22), paid).timerSeconds, 7200);
});

test('finished overtime uses an ended label and zero current rate', () => {
  let records = workAction([], settings, 'overtime', at(19));
  records = workAction(records, settings, 'end', at(20));
  const result = presentation(records, at(21));
  assert.equal(result.rate, 0);
  assert.equal(result.timerLabel, '班次已结束');
  assert.equal(result.timerSeconds, 0);
  assert.equal(result.timerCaption, '本班已结束');
});

test('scheduled paid and unpaid rest have distinct captions and current rates', () => {
  for (const paid of [false, true]) {
    const plan = { ...settings, breaks: [{ start: '12:00', end: '13:00', paid }] };
    const records = workAction([], plan, 'start', at(9));
    const result = presentation(records, at(12, 30), plan);
    assert.equal(result.detail, paid ? '计划有薪休息中' : '计划无薪休息中');
    assert.equal(result.rate > 0, paid);
    assert.equal(result.timerLabel, '距计划下班');
  }
});

test('waiting, early work and estimate do not present standard salary as current income', () => {
  const waiting = presentation([], at(10));
  assert.equal(waiting.rate, 0);
  assert.match(waiting.timerCaption, /待打卡/);
  const early = workAction([], settings, 'start', at(8));
  assert.equal(presentation(early, at(8, 30)).detail, '提前工作，当前不计薪');
  const estimate = presentation([], at(8), { ...settings, trackingMode: 'estimate' });
  assert.equal(estimate.rateLabel, '当前预计');
  assert.equal(estimate.rate, 0);
  assert.equal(presentation([], at(10), { ...settings, workdays: [] }).timerCaption, '今天是休息日');
});

test('overnight captions indicate the next day and work fields remain unchanged', () => {
  const plan = { ...settings, start: '22:00', end: '06:00', breaks: [] };
  const records = workAction([], plan, 'start', at(22));
  const before = structuredClone(records);
  const calculation = calculateRecord(records[0], at(23));
  const result = workPresentation(calculation);
  assert.equal(result.timerCaption, '06:00 次日 计划下班');
  assert.equal(result.rate, 0.025);
  assert.deepEqual(records, before);
});

test('pay notices ignore appearance and reminder settings but detect salary changes', () => {
  assert.equal(hasPendingPaySettings(settings, { ...settings, theme: 'night', overtimeReminderHours: 2 }), false);
  for (const patch of [
    { dailySalary: 800 }, { end: '19:00' }, { paidOvertime: true },
    { overtimeMultiplier: 2 }, { breaks: [] }, { workdays: [] }, { exceptions: [{ date: '2026-10-05', working: false }] },
  ]) assert.equal(hasPendingPaySettings(settings, { ...settings, ...patch }), true);
});

test('long overtime reminders respect the exact threshold and do not change records', () => {
  const records = workAction([], settings, 'overtime', at(19));
  const before = structuredClone(records);
  assert.equal(overtimeReminder(records[0], settings, at(2, 59, 6)), null);
  const reminder = overtimeReminder(records[0], settings, at(3, 0, 6));
  assert.match(reminder.message, /8 小时/);
  assert.match(reminder.key, new RegExp(records[0].id));
  assert.equal(overtimeReminder(records[0], { ...settings, overtimeReminderEnabled: false }, at(4, 0, 6)), null);
  assert.equal(overtimeReminder(records[0], settings, at(18)), null);
  assert.equal(overtimeReminder(records[0], settings, new Date(NaN)), null);
  assert.deepEqual(records, before);
});

test('reminder thresholds follow current preferences even for a legacy salary snapshot', () => {
  const records = workAction([], settings, 'overtime', at(19));
  delete records[0].settings.overtimeReminderEnabled;
  delete records[0].settings.overtimeReminderHours;
  assert.ok(overtimeReminder(records[0], { ...settings, overtimeReminderHours: 1 }, at(20)));
  assert.equal(overtimeReminder(records[0], settings, at(20)), null);
  assert.equal(currentCalculation(settings, records, at(20)).earned, 0);
});

test('reminders include temporary rest in session age, not in earned overtime', () => {
  let records = workAction([], settings, 'overtime', at(19));
  records = workAction(records, settings, 'break', at(20));
  assert.ok(overtimeReminder(records[0], settings, at(3, 0, 6)));
  assert.equal(calculateRecord(records[0], at(3, 0, 6)).overtime, 3600);
  records = workAction(records, settings, 'resume', at(3, 0, 6));
  assert.ok(overtimeReminder(records[0], settings, at(3, 0, 6)));
});

test('finished or normal records never show overtime reminders', () => {
  const normal = workAction([], settings, 'start', at(9));
  assert.equal(overtimeReminder(normal[0], settings, at(19)), null);
  let overtime = workAction([], settings, 'overtime', at(19));
  overtime = workAction(overtime, settings, 'end', at(20));
  assert.equal(overtimeReminder(overtime[0], settings, at(5, 0, 6)), null);
  assert.equal(overtimeReminder(null, settings, at(5, 0, 6)), null);
});

test('a separately reopened overtime session does not inherit the old reminder age', () => {
  let records = workAction([], settings, 'overtime', at(18));
  const oldKey = overtimeReminder(records[0], { ...settings, overtimeReminderHours: 1 }, at(19)).key;
  records = workAction(records, settings, 'end', at(20));
  records = workAction(records, settings, 'overtime', at(22));
  assert.equal(overtimeReminder(records[0], { ...settings, overtimeReminderHours: 3 }, at(23)), null);
  const next = overtimeReminder(records[0], { ...settings, overtimeReminderHours: 1 }, at(23));
  assert.notEqual(next.key, oldKey);
  assert.equal(presentation(records, at(23)).timerSeconds, 3 * 3600);
});

test('legacy v3 data gains reminder defaults without changing stored salary snapshots', () => {
  let state = normalizeData({ settings });
  state = applyOperation(state, { type: 'work', action: 'overtime' }, at(19));
  delete state.settings.overtimeReminderEnabled;
  delete state.settings.overtimeReminderHours;
  delete state.records[0].settings.overtimeReminderEnabled;
  delete state.records[0].settings.overtimeReminderHours;
  const snapshots = structuredClone(state.records);
  const next = normalizeData(state);
  assert.equal(next.settings.overtimeReminderEnabled, true);
  assert.equal(next.settings.overtimeReminderHours, 8);
  assert.deepEqual(next.records, snapshots);
});

test('reminder preferences are validated and may change without changing the active shift', () => {
  let state = normalizeData({ settings });
  state = applyOperation(state, { type: 'work', action: 'overtime' }, at(19));
  const records = structuredClone(state.records);
  state = applyOperation(state, { type: 'settings', patch: { overtimeReminderEnabled: false, overtimeReminderHours: 2 } });
  assert.deepEqual(state.records, records);
  for (const hours of [0, 25, 1.5, '8', NaN]) assert.match(settingsError({ ...settings, overtimeReminderHours: hours }), /提醒/);
  assert.match(settingsError({ ...settings, overtimeReminderEnabled: 'true' }), /提醒/);
});

test('cross-date overtime reminders identify the actual shift and target record', () => {
  const records = workAction([], settings, 'overtime', at(19));
  const before = structuredClone(records);
  const reminder = overtimeReminder(records[0], settings, at(10, 0, 10));
  assert.equal(reminder.recordId, records[0].id);
  assert.match(reminder.message, /2026-10-05 的班次仍未结束/);
  assert.deepEqual(records, before);
  const sameDay = overtimeReminder(records[0], { ...settings, overtimeReminderHours: 1 }, at(20));
  assert.doesNotMatch(sameDay.message, /班次仍未结束/);
});

test('pay comparison describes each changed payroll field without mutating the snapshot', () => {
  const before = structuredClone(settings);
  const next = { ...settings, dailySalary: 800, start: '22:00', end: '06:00', breaks: [], workCalendar: 'cn-2025-2026-v1',
    workdays: [1, 3], exceptions: [{ date: '2026-10-10', working: true }], paidOvertime: true, overtimeMultiplier: 2 };
  const rows = paySettingsRows(settings, next);
  assert.equal(rows.length, 7);
  assert.ok(rows.every(row => row.changed));
  assert.equal(rows[0].current, '¥720.00');
  assert.equal(rows[0].next, '¥800.00');
  assert.match(rows[1].next, /次日/);
  assert.equal(rows[2].next, '无');
  assert.equal(rows[3].next, '周一、周三');
  assert.match(rows[4].next, /中国大陆/);
  assert.match(rows[5].next, /2026-10-10 工作/);
  assert.equal(rows[6].next, '计薪 · 2 倍');
  assert.deepEqual(settings, before);
});

test('pay preview with no recorded shift has no invented current values', () => {
  const rows = paySettingsRows(null, settings);
  assert.ok(rows.every(row => row.current === null && !row.changed));
  assert.ok(paySettingsRows(settings, { ...settings, theme: 'night' }).every(row => !row.changed));
});
