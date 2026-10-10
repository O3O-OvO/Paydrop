import { settingsError } from './settings.js';
import { shiftFor } from './schedule.js';

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
}

export function validateTimes(record) {
  if (!validDate(record.date) || !Array.isArray(record.segments) || !record.segments.length || record.segments.length > 10000) throw new Error('工作记录内容损坏。');
  if (record.finishedAt !== null && !timestamp(record.finishedAt)) throw new Error('工作记录结束时间无效。');
  for (let index = 0; index < record.segments.length; index++) {
    const segment = record.segments[index];
    if (!segment || !['work', 'break', 'overtime'].includes(segment.kind) || !timestamp(segment.start)
      || (segment.end !== null && (!timestamp(segment.end) || segment.end < segment.start))
      || (segment.end === null && (index !== record.segments.length - 1 || record.finishedAt !== null))
      || (index && (record.segments[index - 1].end === null || segment.start < record.segments[index - 1].end))) throw new Error('工作记录时段无效。');
    if (segment.resumeKind && !['work', 'overtime'].includes(segment.resumeKind)) throw new Error('休息恢复类型无效。');
  }
  if (record.finishedAt === null && record.segments.at(-1).end !== null) throw new Error('进行中班次须保留一段未结束的时段。');
  if (record.finishedAt !== null && record.finishedAt < record.segments.at(-1).end) throw new Error('结束时间不能早于最后一段记录。');
}

export function validateRecord(record) {
  if (!record || typeof record.id !== 'string' || !/^[\w-]{1,64}$/.test(record.id) || !record.settings || settingsError(record.settings)) throw new Error('工作记录内容损坏。');
  validateTimes(record);
  if (record.origin !== undefined && record.origin !== 'manual') throw new Error('补卡来源无效。');
  if (record.corrections !== undefined) {
    if (!Array.isArray(record.corrections)) throw new Error('修订历史无效。');
    for (const entry of record.corrections) {
      if (!entry || !timestamp(entry.at) || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 200) throw new Error('修订说明无效。');
      if (entry.previous !== null) validateTimes(entry.previous);
    }
  }
}

export function requireRecordMatch(record, expected) {
  if (!record || !expected || JSON.stringify(record) !== JSON.stringify(expected)) throw new Error('此班次已在另一窗口变化，请重新打开后再操作。');
}

export function finishRecordPatch(record, end) {
  if (!record || record.finishedAt !== null || record.segments.at(-1)?.end !== null) {
    throw new Error('此班次已结束，请重新查看记录。');
  }
  if (!timestamp(end) || end <= record.segments.at(-1).start) {
    throw new Error('结束时间须晚于最后一段开始时间。');
  }
  return {
    date: record.date,
    segments: record.segments.map((segment, index) => index === record.segments.length - 1 ? { ...segment, end } : { ...segment }),
    finishedAt: end,
  };
}

export function requireNoConflict(candidate, records) {
  for (const other of records) {
    if (other.id === candidate.id) continue;
    if (other.date === candidate.date) throw new Error('此日期已有班次，请修正原记录，避免重复计薪。');
    for (const a of candidate.segments) {
      for (const b of other.segments) {
        if (a.start < (b.end ?? Infinity) && b.start < (a.end ?? Infinity)) throw new Error('打卡时段与其他班次重叠。');
      }
    }
  }
}

export function correctedRecord(original, patch, reason, now = new Date()) {
  if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['date', 'segments', 'finishedAt'].includes(key))) throw new Error('只能修正班次日期和打卡时段。');
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200) throw new Error('请填写修正原因（1–200 字）。');
  const candidate = { ...structuredClone(original), ...structuredClone(patch) };
  if (candidate.finishedAt === null) throw new Error('修正或补卡须填写真实结束时间，不会重新开启计薪。');
  validateRecord(candidate);
  if (candidate.finishedAt !== candidate.segments.at(-1).end) throw new Error('班次结束时间须等于最后一段结束时间。');
  const shift = shiftFor(candidate.settings, now, candidate.date);
  const midnight = new Date(`${candidate.date}T00:00:00`).getTime();
  for (const segment of candidate.segments) {
    if (segment.start < midnight || segment.end <= segment.start || segment.end > now.getTime()) throw new Error('时段须晚于班次日期零点，结束晚于开始且不能在未来。');
    if (segment.kind === 'work' && (segment.start >= shift.endAt || segment.end > shift.endAt)) throw new Error('普通工作不能跨过计划下班时间，请另加加班时段。');
    if (segment.kind === 'overtime' && shift.isWorkday && segment.start < shift.endAt) throw new Error('加班须在计划下班之后，提前工作请选普通工作。');
  }
  candidate.segments = candidate.segments.map(segment => ({
    kind: segment.kind, start: segment.start, end: segment.end,
    ...(segment.kind === 'break' ? { resumeKind: segment.resumeKind || 'work' } : {}),
  }));
  candidate.corrections = [...(original.corrections || []), {
    at: now.getTime(), reason: reason.trim(),
    previous: original.segments.length ? { date: original.date, segments: structuredClone(original.segments), finishedAt: original.finishedAt } : null,
  }];
  return candidate;
}

export function backupEnvelope(data, now = new Date()) {
  return { format: 'PaydropBackup', backupVersion: 1, exportedAt: now.toISOString(), data: structuredClone(data) };
}

export function readBackup(input, normalize) {
  if (!input || input.format !== 'PaydropBackup' || input.backupVersion !== 1 || typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt)) || input.data?.schemaVersion !== 3 || !Array.isArray(input.data.records)) throw new Error('请选择 Paydrop 完整备份，配置文件不能恢复工作记录。');
  const data = normalize(input.data);
  // Restores must not introduce double-counted shifts from a malformed backup.
  const dates = new Set();
  const intervals = [];
  for (const record of data.records) {
    if (dates.has(record.date)) throw new Error('备份含重复班次日期。');
    dates.add(record.date);
    for (const segment of record.segments) {
      if (segment.end === null || segment.end > segment.start) intervals.push({ start: segment.start, end: segment.end ?? Infinity });
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  for (let index = 1; index < intervals.length; index++) {
    if (intervals[index].start < intervals[index - 1].end) throw new Error('备份含重叠的打卡时段。');
  }
  return data;
}
