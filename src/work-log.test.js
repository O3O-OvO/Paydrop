import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from './settings.js';
import { workAction, advanceRecords, calculateRecord, currentCalculation, summaries } from './work-log.js';

const settings = normalizeSettings({ dailySalary: 720, start: '09:00', end: '18:00', trackingMode: 'actual' });
const at = (h, m = 0, day = 5) => new Date(2026, 9, day, h, m);

test('actual mode earns nothing before a check-in', () => {
  const result = currentCalculation(settings, [], at(12));
  assert.equal(result.earned, 0);
  assert.equal(result.worked, 0);
  assert.equal(result.state, '待打卡');
});

test('late check-in, multiple temporary breaks and finish persist accurate time', () => {
  let records = workAction([], settings, 'start', at(10));
  records = workAction(records, settings, 'break', at(11));
  records = workAction(records, settings, 'resume', at(11, 15));
  records = workAction(records, settings, 'break', at(14));
  records = workAction(records, settings, 'resume', at(14, 15));
  records = workAction(records, settings, 'end', at(17));
  const result = calculateRecord(records[0], at(23));
  assert.equal(result.worked, 5.5 * 3600);
  assert.equal(result.earned, 495);
  assert.equal(result.unpaid, 0);
  assert.equal(result.state, '已下班');
  assert.equal(records[0].segments.length, 5);
});

test('normal work automatically closes at scheduled end even after sleep', () => {
  const records = workAction([], settings, 'start', at(9));
  const next = advanceRecords(records, at(23));
  assert.equal(next.changed, true);
  assert.equal(next.records[0].finishedAt, at(18).getTime());
  const result = calculateRecord(next.records[0], at(23));
  assert.equal(result.worked, 8 * 3600);
  assert.equal(result.unpaid, 0);
  assert.equal(result.earned, 720);
  assert.equal(advanceRecords(next.records, at(23)).changed, false);
});

test('explicit overtime only counts from actual start with configurable pay multiplier', () => {
  let records = workAction([], settings, 'overtime', at(19));
  records = workAction(records, settings, 'end', at(20));
  assert.equal(calculateRecord(records[0], at(23)).unpaid, 3600);
  assert.equal(calculateRecord(records[0], at(23)).earned, 0);
  const paid = { ...settings, paidOvertime: true, overtimeMultiplier: 2 };
  records = workAction([], paid, 'overtime', at(19));
  records = workAction(records, paid, 'end', at(20));
  assert.equal(calculateRecord(records[0], at(23)).earned, 180);
});

test('overtime and temporary breaks can cross midnight without being auto-closed', () => {
  let records = workAction([], settings, 'overtime', at(23));
  records = workAction(records, settings, 'break', at(23, 30));
  assert.equal(advanceRecords(records, at(0, 30, 6)).changed, false);
  assert.equal(calculateRecord(records[0], at(0, 30, 6)).state, '临时休息');
  records = workAction(records, settings, 'resume', at(0, 30, 6));
  records = workAction(records, settings, 'end', at(1, 0, 6));
  const result = calculateRecord(records[0], at(1, 0, 6));
  assert.equal(records[0].date, '2026-10-05');
  assert.equal(result.overtime, 3600);
  assert.equal(summaries(records, at(1, 0, 6))[0].unpaid, 3600);
});

test('overnight actual shift remains attached to check-in day', () => {
  const night = { ...settings, start: '22:00', end: '06:00', breaks: [{ start: '01:00', end: '01:30' }] };
  let records = workAction([], night, 'start', at(22));
  assert.equal(calculateRecord(records[0], at(2, 0, 6)).worked, 3.5 * 3600);
  records = advanceRecords(records, at(7, 0, 6)).records;
  assert.equal(records[0].finishedAt, at(6, 0, 6).getTime());
  assert.equal(calculateRecord(records[0], at(7, 0, 6)).earned, 720);
});

test('record snapshots are unchanged by later salary changes', () => {
  const records = workAction([], settings, 'start', at(9));
  const result = currentCalculation({ ...settings, dailySalary: 1440 }, records, at(10));
  assert.equal(result.earned, 90);
  assert.equal(result.daily, 720);
});

test('duplicate and invalid work transitions are rejected', () => {
  const records = workAction([], settings, 'start', at(9));
  assert.throws(() => workAction(records, settings, 'start', at(10)), /结束/);
  assert.throws(() => workAction(records, settings, 'resume', at(10)), /状态/);
  assert.throws(() => workAction([], settings, 'end', at(10)), /没有/);
  assert.throws(() => workAction([], settings, 'overtime', at(10)), /尚未下班/);
  assert.throws(() => workAction([], settings, 'start', at(10, 0, 10)), /休息日/);
});

test('resuming a finished day reuses the record without double-counting', () => {
  let records = workAction([], settings, 'start', at(9));
  records = workAction(records, settings, 'end', at(10));
  records = workAction(records, settings, 'start', at(11));
  records = workAction(records, settings, 'end', at(12));
  assert.equal(records.length, 1);
  assert.equal(calculateRecord(records[0], at(23)).earned, 180);
});

test('finished history stays stable and a backwards clock cannot reopen overlapping segments', () => {
  let records = workAction([], settings, 'start', at(9));
  records = workAction(records, settings, 'end', at(10));
  assert.equal(calculateRecord(records[0], at(8)).earned, 90);
  assert.throws(() => workAction(records, settings, 'start', at(9, 30)), /系统时间/);
});

test('reopening the same work day follows its original schedule snapshot', () => {
  let records = workAction([], settings, 'start', at(9));
  records = workAction(records, settings, 'end', at(10));
  const changed = { ...settings, end: '16:00' };
  records = workAction(records, changed, 'start', at(17));
  assert.equal(records[0].settings.end, '18:00');
  assert.equal(calculateRecord(records[0], at(17, 30)).earned, 135);
});
