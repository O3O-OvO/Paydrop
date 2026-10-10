import { dateKey } from './schedule.js';
import { calendarName } from './china-calendar.js';

const PAY_FIELDS = ['dailySalary', 'start', 'end', 'breaks', 'workdays', 'exceptions', 'paidOvertime', 'overtimeMultiplier'];

export function hasPendingPaySettings(plan, settings) {
  return (plan.workCalendar || 'weekly') !== (settings.workCalendar || 'weekly')
    || PAY_FIELDS.some(key => JSON.stringify(plan[key]) !== JSON.stringify(settings[key]));
}

export function paySettingsRows(before, after) {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  const formats = [
    ['日薪', plan => `¥${Number(plan.dailySalary).toFixed(2)}`],
    ['作息', plan => `${plan.start}–${plan.end}${plan.end < plan.start ? '（次日）' : ''}`],
    ['计划休息', plan => plan.breaks.map(rest => `${rest.start}–${rest.end} ${rest.paid ? '有薪' : '无薪'}`).join('；') || '无'],
    ['工作日', plan => [1, 2, 3, 4, 5, 6, 0].filter(day => plan.workdays.includes(day)).map(day => `周${days[day]}`).join('、') || '无'],
    ['工作日历', plan => calendarName(plan.workCalendar)],
    ['特殊日期', plan => plan.exceptions.map(item => `${item.date} ${item.working ? '工作' : '休息'}`).join('；') || '无'],
    ['加班', plan => plan.paidOvertime ? `计薪 · ${plan.overtimeMultiplier} 倍` : `不计薪（倍率 ${plan.overtimeMultiplier} 倍未启用）`],
  ];
  return formats.map(([label, format]) => {
    const current = before ? format(before) : null;
    const next = format(after);
    return { label, current, next, changed: before !== null && current !== next };
  });
}

export function workPresentation(calculation) {
  const c = calculation;
  const overtime = Boolean(c.overtimeActive);
  const nextDay = c.end >= 86400 ? ' 次日' : '';
  let detail;
  if (c.state === '临时休息') detail = '临时无薪休息中';
  else if (overtime) detail = c.accrualRate > 0 ? `有薪加班 · ${c.plan.overtimeMultiplier} 倍` : '无薪加班中';
  else if (c.state === '休息中') detail = c.accrualRate > 0 ? '计划有薪休息中' : '计划无薪休息中';
  else if (c.state === '工作中' && c.accrualRate === 0 && c.current < c.start) detail = '提前工作，当前不计薪';
  else detail = ({ '工作中': '工作中', '未开工': '尚未开工', '待打卡': '尚未打卡', '休息日': '今天是休息日', '已下班': c.mode === 'actual' ? '本班已结束' : '计划班次已结束' })[c.state] || c.state;

  return {
    rateLabel: c.mode === 'actual' ? '当前计薪' : '当前预计',
    rate: c.accrualRate,
    detail,
    timerLabel: overtime ? '已加班' : c.state === '已下班' ? '班次已结束' : c.state === '休息日' ? '今日休息' : '距计划下班',
    timerSeconds: overtime ? c.overtime : c.remaining,
    timerDirection: overtime ? 'up' : 'down',
    timerCaption: overtime ? (c.state === '临时休息' ? '临时休息中，加班时长不增加' : `${detail} · 本班累计`)
      : c.state === '已下班' || c.state === '休息日' ? detail
        : `${c.plan.end}${nextDay} 计划下班${c.state === '待打卡' ? ' · 待打卡' : ''}`,
  };
}

export function overtimeReminder(record, settings, date = new Date()) {
  if (!record || record.finishedAt !== null || settings.overtimeReminderEnabled === false) return null;
  const threshold = settings.overtimeReminderHours ?? 8;
  const belongsToOvertime = segment => segment.kind === 'overtime' || (segment.kind === 'break' && segment.resumeKind === 'overtime');
  let index = record.segments.length - 1;
  if (index < 0 || !belongsToOvertime(record.segments[index])) return null;
  // A same-day reopened record can contain separate overtime sessions.
  while (index > 0 && belongsToOvertime(record.segments[index - 1]) && record.segments[index - 1].end === record.segments[index].start) index--;
  const start = record.segments[index].start;
  const elapsed = date.getTime() - start;
  if (!Number.isFinite(elapsed) || elapsed < threshold * 3600000) return null;
  return {
    key: `${record.id}:${start}`,
    recordId: record.id,
    message: `${record.date !== dateKey(date) ? `${record.date} 的班次仍未结束。` : ''}加班记录已持续 ${threshold} 小时以上，请核对是否仍在工作。`,
  };
}
