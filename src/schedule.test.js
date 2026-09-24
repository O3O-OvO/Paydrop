import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSchedule, resolveBreaks, scheduleError } from './schedule.js';

const settings = {
  dailySalary: 720,
  start: '09:00',
  end: '18:00',
  breaks: [{ start: '15:00', end: '15:15' }, { start: '12:00', end: '13:00' }],
  paidOvertime: false,
};
const at = (hour, minute, second = 0) => new Date(2026, 8, 24, hour, minute, second);

test('multiple breaks are excluded from pay and work time', () => {
  assert.equal(scheduleError(settings), '');
  const first = calculateSchedule(settings, at(12, 30));
  assert.equal(first.state, '休息中');
  assert.equal(first.breakElapsed, 30 * 60);
  assert.equal(first.worked, 3 * 3600);
  assert.equal(first.scheduled, 7 * 3600 + 45 * 60);
  assert.equal(first.earned, first.worked * first.rate);
  assert.equal(calculateSchedule(settings, at(14, 0)).state, '工作中');
  assert.equal(calculateSchedule(settings, at(15, 5)).state, '休息中');
  const secondBreakStart = calculateSchedule(settings, at(15, 0));
  const secondBreakEnd = calculateSchedule(settings, at(15, 15));
  assert.equal(secondBreakStart.state, '休息中');
  assert.equal(secondBreakEnd.state, '工作中');
  assert.equal(secondBreakEnd.earned, secondBreakStart.earned);
  assert.equal(calculateSchedule(settings, at(15, 15, 1)).worked, secondBreakEnd.worked + 1);
  const finished = calculateSchedule(settings, at(18, 0));
  assert.equal(finished.worked, finished.scheduled);
  assert.equal(finished.earned, settings.dailySalary);
  assert.equal(finished.breaks[0].start, '12:00');
});

test('no breaks and unpaid overtime remain supported', () => {
  const noBreaks = { ...settings, breaks: [] };
  assert.equal(scheduleError(noBreaks), '');
  assert.equal(calculateSchedule(noBreaks, at(12, 30)).state, '工作中');
  const late = calculateSchedule(settings, at(18, 30));
  assert.equal(late.unpaid, 1800);
  assert.equal(late.earned, settings.dailySalary);
  assert.equal(calculateSchedule({ ...settings, paidOvertime: true }, at(18, 30)).earned, settings.dailySalary + 1800 * late.rate);
});

test('old settings migrate to one break without changing zero-break schedules', () => {
  const fallback = [{ start: '12:00', end: '13:00' }];
  assert.deepEqual(resolveBreaks({ breakStart: '11:30', breakEnd: '12:15' }, fallback), [{ start: '11:30', end: '12:15' }]);
  assert.deepEqual(resolveBreaks({ breaks: [] }, fallback), []);
  assert.deepEqual(resolveBreaks({ breakStart: '12:00', breakEnd: '12:00' }, fallback), []);
  assert.deepEqual(resolveBreaks({}, fallback), fallback);
});

test('invalid, overlapping and fully unpaid schedules are rejected', () => {
  assert.match(scheduleError({ ...settings, breaks: [{ start: '12:00', end: '13:00' }, { start: '12:30', end: '13:30' }] }), /重叠/);
  assert.match(scheduleError({ ...settings, breaks: [{ start: '08:30', end: '09:30' }] }), /工作时间内/);
  assert.match(scheduleError({ ...settings, breaks: [{ start: '09:00', end: '18:00' }] }), /不能为零/);
  assert.match(scheduleError({ ...settings, breaks: [{ start: '15:00', end: '14:00' }] }), /结束时间/);
  assert.equal(scheduleError({ ...settings, breaks: [{ start: '12:00', end: '12:30' }, { start: '12:30', end: '13:00' }] }), '');
});
