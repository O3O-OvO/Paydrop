import { resolveWorkday } from './china-calendar.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function secondsOfDay(value) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60;
}

export function resolveBreaks(saved, fallback) {
  if (Array.isArray(saved.breaks)) {
    return saved.breaks.map(item => ({ start: item?.start, end: item?.end, ...(item?.paid ? { paid: true } : {}) }));
  }
  if (saved.breakStart !== undefined && saved.breakEnd !== undefined) {
    return saved.breakStart === saved.breakEnd ? [] : [{ start: saved.breakStart, end: saved.breakEnd }];
  }
  return fallback.map(item => ({ ...item }));
}

export function scheduleError(settings) {
  const start = secondsOfDay(settings.start);
  const end = secondsOfDay(settings.end);
  if (!Number.isFinite(Number(settings.dailySalary)) || Number(settings.dailySalary) <= 0) return '日薪须大于零。';
  if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) return '上下班时间须有效且不能相同。';
  if (!Array.isArray(settings.breaks)) return '请检查休息时段。';

  const intervals = settings.breaks.map(item => ({
    ...breakInterval(item, start, end),
    paid: Boolean(item?.paid),
  })).sort((a, b) => a.start - b.start);

  for (let index = 0; index < intervals.length; index++) {
    const item = intervals[index];
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < start || item.end > (end < start ? end + 86400 : end) || item.end <= item.start) {
      return '每段休息须位于工作时间内，结束时间须晚于开始时间。';
    }
    if (index > 0 && item.start < intervals[index - 1].end) return '休息时段不能重叠。';
  }
  const breakSeconds = intervals.reduce((total, item) => total + (item.paid ? 0 : item.end - item.start), 0);
  if (breakSeconds >= (end < start ? end + 86400 : end) - start) return '每日有薪时间不能为零。';
  return '';
}

export function overlap(start, end, from, to) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

function breakInterval(item, start, end) {
  let from = secondsOfDay(item?.start), to = secondsOfDay(item?.end);
  if (end < start) {
    if (from < start) from += 86400;
    if (to < start) to += 86400;
  }
  return { start: from, end: to };
}

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftFor(settings, date = new Date(), anchor) {
  const start = secondsOfDay(settings.start);
  const clockEnd = secondsOfDay(settings.end);
  const end = clockEnd < start ? clockEnd + 86400 : clockEnd;
  const day = anchor ? new Date(`${anchor}T00:00:00`) : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (!anchor && clockEnd < start && date.getHours() * 3600 + date.getMinutes() * 60 < start) day.setDate(day.getDate() - 1);
  const at = seconds => {
    const result = new Date(day);
    result.setSeconds(seconds);
    return result.getTime();
  };
  const breaks = settings.breaks.map(item => ({
    ...item,
    from: breakInterval(item, start, clockEnd).start,
    to: breakInterval(item, start, clockEnd).end,
  })).sort((a, b) => a.from - b.from);
  const key = dateKey(day);
  const calendarDay = resolveWorkday(settings, key);
  return { start, end, breaks, key, isWorkday: calendarDay.working, calendarDay, startAt: at(start), endAt: at(end), at };
}

export function calculateSchedule(settings, date = new Date(), options = {}) {
  const shift = shiftFor(settings, date, options.anchor);
  const { start, end, breaks } = shift;
  const current = start + (date.getTime() - shift.startAt) / 1000;
  const breakTotal = breaks.reduce((total, item) => total + (item.paid ? 0 : item.to - item.from), 0);
  const scheduled = end - start - breakTotal;
  const rate = Number(settings.dailySalary) / scheduled;
  const elapsed = Math.max(0, Math.min(current, end) - start);
  const breakElapsed = breaks.reduce((total, item) => total + (item.paid ? 0 : overlap(start, Math.min(current, end), item.from, item.to)), 0);
  // Estimates stop at shift end. Actual overtime requires a recorded segment.
  const overtime = options.overtime ? Math.max(0, current - end) : 0;
  const worked = shift.isWorkday ? Math.max(0, elapsed - breakElapsed) + overtime : 0;
  const unpaid = settings.paidOvertime ? 0 : overtime;
  const state = !shift.isWorkday ? '休息日' : current < start ? '未开工' : current < end
    ? (breaks.some(item => current >= item.from && current < item.to) ? '休息中' : '工作中')
    : options.overtime ? '加班中' : '已下班';
  const currentRest = state === '休息中' ? breaks.find(item => current >= item.from && current < item.to) : null;

  return {
    current, start, end, breaks, breakTotal, breakElapsed, scheduled, rate, worked, overtime, unpaid,
    earned: (worked - overtime) * rate + (settings.paidOvertime ? overtime * rate * (settings.overtimeMultiplier || 1) : 0),
    remaining: shift.isWorkday ? Math.max(0, end - current) : 0,
    progress: shift.isWorkday ? Math.min(100, Math.max(0, elapsed / (end - start) * 100)) : 0,
    state, restSeconds: currentRest ? Math.max(0, Math.floor((date.getTime() - shift.at(currentRest.from)) / 1000)) : 0,
    daily: Number(settings.dailySalary),
    accrualRate: shift.isWorkday && current >= start && current < end && !breaks.some(item => !item.paid && current >= item.from && current < item.to) ? rate : 0,
    ...shift,
    mode: 'estimate',
    plan: settings,
  };
}
