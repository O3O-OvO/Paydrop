import { calculateSchedule, overlap, shiftFor } from './schedule.js';

export function activeRecord(records) {
  return records.find(record => !record.finishedAt);
}

export function advanceRecords(records, date = new Date()) {
  let changed = false;
  const next = records.map(record => {
    if (record.finishedAt) return record;
    const shift = shiftFor(record.settings, date, record.date);
    const last = record.segments.at(-1);
    if (last?.kind === 'overtime' || (last?.kind === 'break' && last.resumeKind === 'overtime') || date.getTime() < shift.endAt) return record;
    changed = true;
    return { ...record, finishedAt: shift.endAt, segments: record.segments.map(segment => segment.end === null ? { ...segment, end: Math.max(segment.start, shift.endAt) } : segment) };
  });
  return { records: next, changed };
}

export function workAction(records, settings, action, date = new Date()) {
  let next = structuredClone(advanceRecords(records, date).records);
  let record = activeRecord(next);
  const timestamp = date.getTime();
  if (action === 'start' || action === 'overtime') {
    if (record) throw new Error('请先结束当前工作，再开始新的记录。');
    let shift = shiftFor(settings, date);
    const existing = next.find(item => item.date === shift.key);
    if (existing) shift = shiftFor(existing.settings, date, existing.date);
    if (action === 'start' && !shift.isWorkday) throw new Error('今天是休息日；可在设置中添加工作日例外。');
    if (action === 'start' && timestamp >= shift.endAt) throw new Error('已过下班时间，请选择开始加班。');
    if (action === 'overtime' && timestamp < shift.endAt && shift.isWorkday) throw new Error('尚未下班，请使用开始工作。');
    if (existing) {
      if (timestamp < existing.segments.at(-1).end) throw new Error('系统时间早于上一段记录，请校准后再操作。');
      record = existing;
      record.finishedAt = null;
    } else {
      record = { id: globalThis.crypto.randomUUID(), date: shift.key, settings: structuredClone(settings), segments: [], finishedAt: null };
      next.unshift(record);
    }
    record.segments.push({ kind: action === 'overtime' ? 'overtime' : 'work', start: timestamp, end: null });
  } else {
    if (!record) throw new Error('没有正在进行的工作记录。');
    const last = record.segments.at(-1);
    if (timestamp < last.start) throw new Error('系统时间早于打卡时间，请校准后再操作。');
    if (action === 'end') {
      last.end = timestamp;
      record.finishedAt = timestamp;
    } else if (action === 'break' && last.kind !== 'break') {
      last.end = timestamp;
      record.segments.push({ kind: 'break', resumeKind: last.kind, start: timestamp, end: null });
    } else if (action === 'resume' && last.kind === 'break') {
      last.end = timestamp;
      record.segments.push({ kind: last.resumeKind || 'work', start: timestamp, end: null });
    } else throw new Error('当前状态不支持此操作。');
  }
  return next;
}

export function calculateRecord(record, date = new Date()) {
  const settings = record.settings;
  const base = calculateSchedule(settings, date, { anchor: record.date });
  let worked = 0, paidSeconds = 0, overtime = 0, unpaid = 0, earned = 0;
  for (const segment of record.segments) {
    if (segment.kind === 'break') continue;
    const from = segment.start;
    const to = Math.max(from, record.finishedAt ? (segment.end ?? record.finishedAt) : Math.min(segment.end ?? date.getTime(), date.getTime()));
    const seconds = (to - from) / 1000;
    if (segment.kind === 'overtime') {
      worked += seconds;
      overtime += seconds;
      if (settings.paidOvertime) earned += seconds * base.rate * settings.overtimeMultiplier;
      else unpaid += seconds;
    } else {
      const within = overlap(from, to, base.startAt, base.endAt) / 1000;
      let excluded = 0;
      for (const rest of base.breaks) {
        if (!rest.paid) excluded += overlap(from, to, base.at(rest.from), base.at(rest.to)) / 1000;
      }
      worked += Math.max(0, Math.min(seconds, (base.endAt - from) / 1000) - excluded);
      paidSeconds += Math.max(0, within - excluded);
      unpaid += Math.max(0, Math.min(to, base.startAt) - from) / 1000;
    }
  }
  earned += paidSeconds * base.rate;
  const last = record.segments.at(-1);
  const overtimeActive = last?.kind === 'overtime' || (last?.kind === 'break' && last.resumeKind === 'overtime');
  const state = record.finishedAt || (!overtimeActive && date.getTime() >= base.endAt) ? '已下班'
    : last?.kind === 'break' ? '临时休息'
    : last?.kind === 'overtime' ? '加班中'
    : base.state === '休息中' ? '休息中' : '工作中';
  const accrualRate = record.finishedAt || last?.kind === 'break' ? 0 : last?.kind === 'overtime' ? (settings.paidOvertime ? base.rate * settings.overtimeMultiplier : 0)
    : date.getTime() >= base.startAt && date.getTime() < base.endAt && !base.breaks.some(rest => !rest.paid && date.getTime() >= base.at(rest.from) && date.getTime() < base.at(rest.to)) ? base.rate : 0;
  return { ...base, remaining: record.finishedAt ? 0 : base.remaining, worked: Math.floor(worked), overtime: Math.floor(overtime), unpaid: Math.floor(unpaid), earned, accrualRate, state, mode: 'actual', recordId: record.id };
}

export function currentCalculation(settings, records, date = new Date()) {
  const active = activeRecord(records);
  if (active) return calculateRecord(active, date);
  if (settings.trackingMode === 'estimate') return calculateSchedule(settings, date);
  const base = calculateSchedule(settings, date);
  const record = records.find(item => item.date === base.key);
  return record ? calculateRecord(record, date) : { ...base, earned: 0, worked: 0, overtime: 0, unpaid: 0, accrualRate: 0, state: base.isWorkday ? '待打卡' : '休息日', mode: 'actual' };
}

export function summaries(records, date = new Date()) {
  return records.map(record => {
    const value = calculateRecord(record, date);
    return { id: record.id, date: record.date, earned: value.earned, worked: value.worked, unpaid: value.unpaid, overtime: value.overtime, state: value.state, finished: Boolean(record.finishedAt), segments: record.segments.length };
  }).sort((a, b) => b.date.localeCompare(a.date));
}
