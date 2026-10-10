import { dateKey } from './schedule.js';

export function needsSetup(data) {
  return data.settings.setupComplete === false && !data.records.length && !(data.archivedRecords?.length);
}

export function shiftExperience(calculation, date = new Date()) {
  const c = calculation;
  const resting = c.state === '临时休息' || c.state === '休息中';
  const historical = Boolean(c.recordId && c.key !== dateKey(date) && date.getTime() >= c.endAt && c.state !== '已下班');
  return {
    historical,
    heading: historical ? '历史班次待核对' : '今日概览',
    resting,
    restLabel: c.state === '临时休息' ? '本次休息' : '计划休息已过',
    restCaption: c.state === '临时休息' ? '不计薪 · 继续工作后恢复'
      : c.accrualRate > 0 ? '有薪计划休息' : '无薪计划休息',
    restSeconds: c.restSeconds || 0,
    showProgress: c.isWorkday && !c.overtimeActive && !historical,
    progress: Math.max(0, Math.min(100, Number(c.progress) || 0)),
  };
}
