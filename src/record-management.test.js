import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeData, applyOperation } from './data-model.js';
import { normalizeSettings } from './settings.js';
import { calculateRecord, workAction } from './work-log.js';
import { backupEnvelope, readBackup, validDate, finishRecordPatch } from './record-management.js';

const at = (hour, minute = 0, day = 5) => new Date(2026, 9, day, hour, minute);
const now = at(12, 0, 10);
const plan = normalizeSettings({ dailySalary: 720, start: '09:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00' }], trackingMode: 'actual', paidOvertime: true, overtimeMultiplier: 2 });
const segment = (kind, from, to) => ({ kind, start: from.getTime(), end: to?.getTime() ?? null });

test('quick finish only closes the last segment and preserves earlier punches and salary', () => {
  let records = workAction([], plan, 'overtime', at(19));
  records = workAction(records, plan, 'break', at(20));
  records = workAction(records, plan, 'resume', at(20, 15));
  records[0].segments[0].start += 123;
  const original = structuredClone(records[0]);
  const data = normalizeData({ settings: { ...plan, dailySalary: 999 }, records });
  const patch = finishRecordPatch(original, at(21).getTime());
  const next = applyOperation(data, { type: 'correct-record', id: original.id, expected: original, patch, reason: '补填真实下班时间' }, now);
  assert.deepEqual(next.records[0].segments.slice(0, -1), original.segments.slice(0, -1));
  assert.deepEqual(next.records[0].settings, original.settings);
  assert.equal(next.records[0].finishedAt, at(21).getTime());
  assert.equal(next.records[0].corrections.at(-1).previous.finishedAt, null);
  assert.deepEqual(records[0], original);
});

test('quick finish while resting does not convert rest into paid work', () => {
  let records = workAction([], plan, 'overtime', at(19));
  records = workAction(records, plan, 'break', at(20));
  const record = records[0];
  const patch = finishRecordPatch(record, at(21).getTime());
  const result = applyOperation(normalizeData({ settings: plan, records }), {
    type: 'correct-record', id: record.id, expected: record, patch, reason: '休息后已离岗',
  }, now);
  assert.equal(result.records[0].segments.at(-1).kind, 'break');
  assert.equal(result.records[0].segments.at(-1).resumeKind, 'overtime');
  assert.equal(calculateRecord(result.records[0], now).worked, 3600);
});

test('quick finish rejects stale records, missing end times, future times and reversed ranges', () => {
  const data = fixture(true);
  const record = data.records[0];
  for (const end of [NaN, null, record.segments[0].start, record.segments[0].start - 1]) {
    assert.throws(() => finishRecordPatch(record, end), /结束时间/);
  }
  assert.throws(() => finishRecordPatch({ ...record, finishedAt: at(20).getTime() }, at(21).getTime()), /已结束/);
  const operation = { type: 'correct-record', id: record.id, expected: record,
    patch: finishRecordPatch(record, at(20).getTime()), reason: '忘记下班' };
  const changed = applyOperation(data, { type: 'work', action: 'break' }, at(19, 30));
  assert.throws(() => applyOperation(changed, operation, now), /另一窗口/);
  const future = { ...operation, patch: finishRecordPatch(record, at(13, 0, 10).getTime()) };
  assert.throws(() => applyOperation(data, future, now), /未来/);
});
function fixture(active = false) {
  let records = workAction([], plan, 'overtime', at(19));
  if (!active) records = workAction(records, plan, 'end', at(22));
  return normalizeData({ settings: { ...plan, dailySalary: 1440 }, records });
}
function correction(data, segments = [segment('overtime', at(19), at(20))]) {
  const record = data.records[0];
  return { type: 'correct-record', id: record.id, expected: structuredClone(record), patch: { date: record.date, segments, finishedAt: segments.at(-1).end }, reason: '忘记下班打卡' };
}
function addition(data, date = '2026-10-06', id = 'manual-record') {
  const segments = [segment('work', at(9, 0, 6), at(18, 0, 6))];
  return { type: 'add-record', id, expectedRevision: data.revision, patch: { date, segments, finishedAt: segments.at(-1).end }, reason: '补录漏打卡' };
}

test('legacy v3 migrates without discarding snapshots and optional records metadata survives roundtrip', () => {
  const data = fixture();
  const legacy = structuredClone(data); delete legacy.archivedRecords;
  assert.deepEqual(normalizeData(legacy).records, data.records);
  const corrected = applyOperation(data, correction(data), now);
  assert.deepEqual(normalizeData(JSON.parse(JSON.stringify(corrected))), corrected);
});

test('record dates and timestamps are validated, including leap years and finished boundaries', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-13-01'), false);
  const data = fixture();
  for (const invalid of ['2026-02-30', '2026-00-01']) {
    const bad = structuredClone(data); bad.records[0].date = invalid;
    assert.throws(() => normalizeData(bad), /损坏/);
  }
  const bad = structuredClone(data); bad.records[0].finishedAt = at(18).getTime();
  assert.throws(() => normalizeData(bad), /最后一段/);
  bad.records[0].finishedAt = null;
  assert.throws(() => normalizeData(bad), /未结束/);
});

test('correction preserves salary snapshot, records original times and recalculates earnings', () => {
  const data = fixture();
  const previous = structuredClone(data.records[0]);
  const next = applyOperation(data, correction(data), now);
  const record = next.records[0];
  assert.equal(record.settings.dailySalary, 720);
  assert.deepEqual(record.settings, previous.settings);
  assert.equal(calculateRecord(record, now).earned, 180);
  assert.equal(calculateRecord(record, now).worked, 3600);
  assert.deepEqual(record.corrections[0].previous.segments, previous.segments);
  assert.equal(record.corrections[0].reason, '忘记下班打卡');
  assert.deepEqual(data.records[0], previous);
});

test('forgotten active overtime can be finalized at the actual past finish without reopening', () => {
  const data = fixture(true);
  const next = applyOperation(data, correction(data), now);
  assert.equal(next.records[0].finishedAt, at(20).getTime());
  assert.equal(next.records[0].corrections[0].previous.finishedAt, null);
  assert.equal(calculateRecord(next.records[0], at(12, 0, 20)).earned, 180);
});

test('stale correction, deletion and restoration fail without changing current state', () => {
  const data = fixture();
  const op = correction(data);
  const changed = applyOperation(data, op, now);
  const before = structuredClone(changed);
  assert.throws(() => applyOperation(changed, op, now), /另一窗口/);
  assert.throws(() => applyOperation(changed, { type: 'delete-record', id: op.id, expected: op.expected }, now), /另一窗口/);
  assert.deepEqual(changed, before);
  assert.throws(() => applyOperation(changed, { type: 'restore-record', id: 'missing', expected: op.expected }, now), /另一窗口/);
});

test('independent settings edits do not conflict with a correction of a frozen record', () => {
  const data = fixture();
  const op = correction(data);
  const changed = applyOperation(data, { type: 'settings', patch: { theme: 'night' } }, now);
  const next = applyOperation(changed, op, now);
  assert.equal(next.settings.theme, 'night');
  assert.deepEqual(next.records[0].settings, data.records[0].settings);
});

test('invalid corrections never reopen a shift, rewrite pay settings or accept future and overlapping times', () => {
  const data = fixture();
  const op = correction(data);
  assert.throws(() => applyOperation(data, { ...op, patch: { ...op.patch, settings: plan } }, now), /只能修正/);
  assert.throws(() => applyOperation(data, { ...op, reason: ' ' }, now), /原因/);
  assert.throws(() => applyOperation(data, { ...op, patch: { ...op.patch, finishedAt: null } }, now), /不会重新开启/);
  const cases = [
    [segment('overtime', at(19), at(19))],
    [segment('overtime', at(19), at(20, 0, 11))],
    [segment('overtime', at(19), at(21)), segment('break', at(20), at(22))],
    [segment('work', at(17), at(19))],
    [segment('overtime', at(17), at(18))],
  ];
  for (const segments of cases) assert.throws(() => applyOperation(data, correction(data, segments), now));
  assert.equal(data.records[0].finishedAt, at(22).getTime());
});

test('multiple temporary breaks and explicit overtime remain independently accounted', () => {
  const data = fixture();
  const segments = [segment('work', at(9), at(10)), segment('break', at(10), at(10, 15)),
    segment('work', at(10, 15), at(18)), segment('overtime', at(18), at(19)),
    { ...segment('break', at(19), at(19, 30)), resumeKind: 'overtime' }, segment('overtime', at(19, 30), at(20))];
  const next = applyOperation(data, correction(data, segments), now);
  const result = calculateRecord(next.records[0], now);
  assert.equal(result.overtime, 5400);
  assert.equal(result.worked, 7.75 * 3600 + 5400);
  assert.equal(result.earned, 7.75 * 90 + 1.5 * 180);
});

test('cross-midnight corrections use frozen shift date and allow next-day end', () => {
  const night = normalizeSettings({ ...plan, start: '22:00', end: '06:00', breaks: [] });
  const records = [{ id: 'night', date: '2026-10-05', settings: night, segments: [segment('work', at(22), at(6, 0, 6))], finishedAt: at(6, 0, 6).getTime() }];
  const data = normalizeData({ settings: night, records });
  const next = applyOperation(data, correction(data, [segment('work', at(23), at(5, 0, 6))]), now);
  assert.equal(next.records[0].date, '2026-10-05');
  assert.equal(calculateRecord(next.records[0], now).worked, 21600);
});

test('manual backfill freezes current settings and cannot duplicate dates, ids or overlap another shift', () => {
  const data = fixture();
  const next = applyOperation(data, addition(data), now);
  const manual = next.records[0];
  assert.equal(manual.origin, 'manual');
  assert.equal(manual.settings.dailySalary, 1440);
  assert.equal(manual.corrections[0].previous, null);
  assert.equal(calculateRecord(manual, now).earned, 1440);
  assert.throws(() => applyOperation(next, addition(next, '2026-10-06', 'duplicate-date'), now), /已有班次/);
  assert.throws(() => applyOperation(next, addition(next), now), /ID/);
  const overlap = addition(data, '2026-10-04');
  overlap.patch.segments = [segment('overtime', at(19, 30), at(20))];
  overlap.patch.finishedAt = at(20).getTime();
  assert.throws(() => applyOperation(data, overlap, now), /重叠/);
  const changed = applyOperation(data, { type: 'settings', patch: { dailySalary: 333 } }, now);
  assert.throws(() => applyOperation(changed, addition(data), now), /数据已变化/);
});

test('soft deletion and recovery preserve corrections and income and never resume work', () => {
  const data = fixture();
  const corrected = applyOperation(data, correction(data), now);
  const record = corrected.records[0];
  const deleted = applyOperation(corrected, { type: 'delete-record', id: record.id, expected: record }, now);
  assert.deepEqual(deleted.archivedRecords[0].record, record);
  const restored = applyOperation(deleted, { type: 'restore-record', id: record.id, expected: record }, now);
  assert.equal(restored.records[0].finishedAt, at(20).getTime());
  assert.equal(calculateRecord(restored.records[0], now).earned, 180);
});

test('archive survives reload; restore conflicts are explicit and data remains archived', () => {
  const data = fixture();
  const next = applyOperation(data, correction(data), now);
  const expected = next.records[0];
  const deleted = applyOperation(next, { type: 'delete-record', id: expected.id, expected }, now);
  assert.equal(deleted.records.length, 0);
  assert.equal(deleted.archivedRecords.length, 1);
  const restored = applyOperation(normalizeData(deleted), { type: 'restore-record', id: expected.id, expected }, now);
  assert.deepEqual(restored.records[0], expected);
  assert.equal(restored.archivedRecords.length, 0);
  const conflicting = structuredClone(deleted);
  conflicting.records.push({ ...expected, id: 'replacement' });
  assert.throws(() => applyOperation(conflicting, { type: 'restore-record', id: expected.id, expected }, now), /已有班次/);
  assert.equal(conflicting.archivedRecords.length, 1);
});

test('archive rejects active, malformed and duplicate ids', () => {
  const data = fixture();
  const entry = { record: data.records[0], deletedAt: now.getTime() };
  assert.throws(() => normalizeData({ ...data, archivedRecords: [entry] }), /状态/);
  assert.throws(() => normalizeData({ ...data, records: [], archivedRecords: [{ ...entry, record: fixture(true).records[0] }] }), /状态/);
  assert.throws(() => normalizeData({ ...data, archivedRecords: {} }), /格式/);
});

test('corrections beyond ten retain the complete history and survive backup roundtrips', () => {
  let data = fixture();
  const original = structuredClone(data.records[0]);
  for (let i = 0; i < 25; i++) {
    const previous = structuredClone(data.records[0]);
    data = applyOperation(data, { ...correction(data, [segment('overtime', at(19), at(20, i))]), reason: `修正 ${i}` }, now);
    assert.deepEqual(data.records[0].corrections[i].previous.segments, previous.segments);
    assert.deepEqual(data.records[0].settings, original.settings);
  }
  assert.equal(data.records[0].corrections.length, 25);
  assert.deepEqual(data.records[0].corrections[0].previous.segments, original.segments);
  const decoded = readBackup(JSON.parse(JSON.stringify(backupEnvelope(data, now))), normalizeData);
  assert.deepEqual(decoded, data);
  const current = normalizeData();
  const restored = applyOperation(current, { type: 'restore-backup', backup: backupEnvelope(decoded, now), expectedRevision: current.revision }, now);
  assert.deepEqual(restored.records, data.records);
  const corrupt = structuredClone(data);
  corrupt.records[0].corrections[24].previous.segments[0].start = NaN;
  assert.throws(() => normalizeData(corrupt), /时段/);
});

test('a shift with ten prior revisions can still correct a resumed overtime finish', () => {
  let data = fixture();
  for (let i = 0; i < 10; i++) data = applyOperation(data, { ...correction(data), reason: `修正 ${i}` }, now);
  data = readBackup(backupEnvelope(data, now), normalizeData);
  data = applyOperation(data, { type: 'work', action: 'overtime' }, at(21));
  const active = structuredClone(data.records[0]);
  const segments = [...active.segments.slice(0, -1), segment('overtime', at(21), at(22))];
  const next = applyOperation(data, correction(data, segments), now);
  assert.equal(next.records[0].finishedAt, at(22).getTime());
  assert.equal(next.records[0].corrections.length, 11);
  assert.equal(next.records[0].corrections[10].previous.finishedAt, null);
  assert.deepEqual(next.records[0].corrections.slice(0, 10), active.corrections);
  assert.equal(data.records[0].finishedAt, null);
  const deleted = applyOperation(next, { type: 'delete-record', id: active.id, expected: next.records[0] }, now);
  const restored = applyOperation(deleted, { type: 'restore-record', id: active.id, expected: next.records[0] }, now);
  assert.deepEqual(restored.records[0], next.records[0]);
});

test('unbounded revision counts still reject malformed histories and late corrupt entries', () => {
  const data = fixture();
  for (const invalid of [null, {}, 'history']) {
    assert.throws(() => normalizeData({ ...data, records: [{ ...data.records[0], corrections: invalid }] }), /历史/);
  }
  const corrected = applyOperation(data, correction(data), now);
  corrected.records[0].corrections = Array.from({ length: 15 }, () => structuredClone(corrected.records[0].corrections[0]));
  corrected.records[0].corrections[14].reason = '';
  assert.throws(() => normalizeData(corrected), /说明/);
});
test('full backup restores every field with a monotonic local revision', () => {
  let imported = fixture();
  imported = applyOperation(imported, correction(imported), now);
  const record = imported.records[0];
  imported = applyOperation(imported, { type: 'delete-record', id: record.id, expected: record }, now);
  const backup = backupEnvelope(imported, now);
  const current = { ...normalizeData(), revision: 500 };
  const restored = applyOperation(current, { type: 'restore-backup', backup, expectedRevision: 500 }, now);
  assert.equal(restored.revision, 501);
  assert.deepEqual(restored.archivedRecords, imported.archivedRecords);
  assert.deepEqual(restored.settings, imported.settings);
  assert.deepEqual(readBackup(backup, normalizeData), imported);
});

test('restore requires a current preview, no live current shift, and explicit imported-active approval', () => {
  const data = fixture();
  const backup = backupEnvelope(fixture(true), now);
  assert.throws(() => applyOperation(data, { type: 'restore-backup', backup, expectedRevision: -1 }, now), /重新预览/);
  assert.throws(() => applyOperation(fixture(true), { type: 'restore-backup', backup, expectedRevision: 0, resumeActive: true }, now), /结束当前班次/);
  assert.throws(() => applyOperation(data, { type: 'restore-backup', backup, expectedRevision: 0 }, now), /明确确认/);
  const restored = applyOperation(data, { type: 'restore-backup', backup, expectedRevision: 0, resumeActive: true }, now);
  assert.equal(restored.records[0].finishedAt, null);
});

test('backup rejects settings-only files, unsupported versions and double-counted records', () => {
  const data = fixture();
  assert.throws(() => readBackup({ schemaVersion: 3, settings: plan }, normalizeData), /完整备份/);
  assert.throws(() => readBackup({ ...backupEnvelope(data), backupVersion: 2 }, normalizeData), /完整备份/);
  const duplicate = structuredClone(data);
  duplicate.records.push({ ...duplicate.records[0], id: 'second' });
  assert.throws(() => readBackup(backupEnvelope(duplicate), normalizeData), /重复班次/);
  duplicate.records[1].date = '2026-10-04';
  assert.throws(() => readBackup(backupEnvelope(duplicate), normalizeData), /重叠/);
  const activeOverlap = fixture(true);
  activeOverlap.records.push({ ...data.records[0], date: '2026-10-06' });
  assert.throws(() => readBackup(backupEnvelope(activeOverlap), normalizeData), /重叠/);
});

test('unsafe revision counters cannot break multi-window monotonic ordering', () => {
  const state = { ...normalizeData(), revision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => applyOperation(state, { type: 'settings', patch: { dailySalary: 123 } }, now), /计数异常/);
  assert.equal(state.settings.dailySalary, 545.45);
});
