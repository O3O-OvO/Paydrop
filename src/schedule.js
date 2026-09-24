const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function secondsOfDay(value) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 3600 + minutes * 60;
}

export function resolveBreaks(saved, fallback) {
  if (Array.isArray(saved.breaks)) {
    return saved.breaks.map(item => ({ start: item?.start, end: item?.end }));
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
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '下班时间须晚于上班时间。';
  if (!Array.isArray(settings.breaks)) return '请检查休息时段。';

  const intervals = settings.breaks.map(item => ({
    start: secondsOfDay(item?.start),
    end: secondsOfDay(item?.end),
  })).sort((a, b) => a.start - b.start);

  for (let index = 0; index < intervals.length; index++) {
    const item = intervals[index];
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < start || item.end > end || item.end <= item.start) {
      return '每段休息须位于工作时间内，结束时间须晚于开始时间。';
    }
    if (index > 0 && item.start < intervals[index - 1].end) return '休息时段不能重叠。';
  }
  const breakSeconds = intervals.reduce((total, item) => total + item.end - item.start, 0);
  if (breakSeconds >= end - start) return '每日有薪时间不能为零。';
  return '';
}

function overlap(start, end, from, to) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

export function calculateSchedule(settings, date = new Date()) {
  const current = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  const start = secondsOfDay(settings.start);
  const end = secondsOfDay(settings.end);
  const breaks = settings.breaks.map(item => ({
    ...item,
    from: secondsOfDay(item.start),
    to: secondsOfDay(item.end),
  })).sort((a, b) => a.from - b.from);
  const breakTotal = breaks.reduce((total, item) => total + item.to - item.from, 0);
  const scheduled = end - start - breakTotal;
  const rate = Number(settings.dailySalary) / scheduled;
  const elapsed = Math.max(0, Math.min(current, end) - start);
  const breakElapsed = breaks.reduce((total, item) => total + overlap(start, Math.min(current, end), item.from, item.to), 0);
  const overtime = Math.max(0, current - end);
  const worked = Math.max(0, elapsed - breakElapsed) + overtime;
  const unpaid = settings.paidOvertime ? 0 : overtime;
  const state = current < start ? '未开工' : current < end
    ? (breaks.some(item => current >= item.from && current < item.to) ? '休息中' : '工作中')
    : settings.paidOvertime ? '加班中' : '已下班';

  return {
    current, start, end, breaks, breakTotal, breakElapsed, scheduled, rate, worked, overtime, unpaid,
    earned: (worked - unpaid) * rate,
    remaining: Math.max(0, end - current),
    progress: Math.min(100, Math.max(0, elapsed / (end - start) * 100)),
    state,
    daily: Number(settings.dailySalary),
  };
}
