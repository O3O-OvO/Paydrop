import { CHINA_CALENDAR, CALENDAR_SOURCES, officialDay, resolveWorkday, lunarDate } from './china-calendar.js';
import { dateKey } from './schedule.js';

export function validMonth(value) {
  return typeof value === 'string' && /^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
}
export function moveMonth(value, direction) {
  const date = new Date(`${value}-15T12:00:00`);
  date.setMonth(date.getMonth() + direction);
  const next = dateKey(date).slice(0, 7);
  return validMonth(next) ? next : value;
}
export function monthDays(month, settings) {
  if (!validMonth(month)) return [];
  const date = new Date(`${month}-01T12:00:00`);
  const rows = [];
  while (dateKey(date).startsWith(month)) {
    const key = dateKey(date);
    rows.push({ key, day: date.getDate(), ...resolveWorkday(settings, key) });
    date.setDate(date.getDate() + 1);
  }
  return rows;
}
export function calendarView(settings, month, selected, icon) {
  const days = monthDays(month, settings);
  const first = (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7;
  const selectedDay = resolveWorkday(settings, selected);
  const today = dateKey(new Date());
  const source = CALENDAR_SOURCES[Number(month.slice(0, 4))];
  const enabled = settings.workCalendar === CHINA_CALENDAR;
  const workCount = days.filter(day => day.working).length;
  const official = officialDay(selected);
  const selectedDate = new Date(`${selected}T12:00:00`);
  const selectedWeekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][selectedDate.getDay()];
  const sourceLabel = { manual: '手动特殊日期', official: '官方放假调休', weekly: '每周作息', fallback: '每周作息（未收录年份）' }[selectedDay.source];
  return `<div class="calendar-workspace">
    <header class="calendar-heading"><div><h1>中国日历</h1><p>放假、补班与自己的工作节奏</p></div><div class="calendar-heading-actions"><img class="calendar-mascot" src="./hachiware-face.png" width="60" height="60" alt=""><button class="outline-button" id="quick-settings">${icon('settings-2')} 调整作息</button></div></header>
    <div class="calendar-policy"><label class="switch-row"><div><strong>采用中国节假日与调休</strong><span>${enabled ? '已启用 · 手动特殊日期优先' : '未启用 · 当前仍按每周作息计薪'}</span></div><input type="checkbox" id="calendar-enable" ${enabled ? 'checked' : ''}><i></i></label></div>
    <div class="calendar-layout">
    <section class="calendar-section" aria-label="月历"><div class="calendar-toolbar"><div class="calendar-month-title"><label class="sr-only" for="calendar-month">选择月份</label><input id="calendar-month" type="month" min="1900-01" max="2100-12" value="${month}"><p>本月计划 <strong>${workCount}</strong> 个工作日<span> / </span>${days.length - workCount} 天休息</p></div><div class="calendar-month-controls"><button class="outline-button" id="calendar-today">${icon('rotate-ccw')} 今天</button><button class="icon-button" data-calendar-step="-1" aria-label="上个月" title="上个月" ${month === '1900-01' ? 'disabled' : ''}>${icon('chevron-left')}</button><button class="icon-button" data-calendar-step="1" aria-label="下个月" title="下个月" ${month === '2100-12' ? 'disabled' : ''}>${icon('chevron-right')}</button></div></div>
      ${!source ? `<p class="calendar-warning" role="status">${month.slice(0, 4)} 年未收录官方安排，按每周作息与手动特殊日期计算；不推测放假或补班。</p>` : ''}
      <div class="calendar-weekdays" aria-hidden="true">${['一', '二', '三', '四', '五', '六', '日'].map(day => `<span>周${day}</span>`).join('')}</div>
      <div class="calendar-grid" role="group" aria-label="${month} 日期">${Array.from({ length: first }, () => '<span class="calendar-empty" aria-hidden="true"></span>').join('')}${days.map(day => {
        const badge = day.source === 'manual' ? '自' : day.official.name ? day.official.working ? '班' : '休' : '';
        const title = day.source === 'manual' ? day.label : day.official.name || lunarDate(day.key);
        const officialLabel = day.official.name ? `${day.official.name}${day.official.working ? '补班' : '放假'}` : '';
        return `<button type="button" class="calendar-day ${day.working ? 'working' : 'resting'} ${day.key === today ? 'today' : ''} ${day.official.name ? day.official.working ? 'official-makeup' : 'official-holiday' : ''}" data-calendar-day="${day.key}" aria-pressed="${day.key === selected}" aria-label="${day.key} ${officialLabel} 当前${day.label}" title="${day.key} · ${day.label}${officialLabel ? ` · 官方：${officialLabel}` : ''}" ${day.key === today ? 'aria-current="date"' : ''}><span class="calendar-day-top"><b>${day.day}</b>${badge ? `<span class="calendar-badge ${day.source === 'manual' ? 'manual' : day.official.working ? 'makeup' : 'holiday'}">${badge}</span>` : ''}</span><small>${title}</small></button>`;
      }).join('')}${Array.from({ length: (7 - (first + days.length) % 7) % 7 }, () => '<span class="calendar-empty" aria-hidden="true"></span>').join('')}</div>
      <div class="calendar-legend"><span><i class="calendar-badge holiday">休</i> 官方放假</span><span><i class="calendar-badge makeup">班</i> 调休上班</span><span><i class="calendar-badge manual">自</i> 手动安排</span></div>
    </section>
    <section class="calendar-selection" aria-label="所选日期">
      <div class="calendar-selected-heading"><span class="calendar-selected-number" aria-hidden="true">${selectedDate.getDate()}</span><div><h2>${selected}</h2><p>${selectedWeekday}<span> · </span>${lunarDate(selected)}</p></div></div>
      <div class="calendar-selected-plan ${selectedDay.working ? 'is-work' : 'is-rest'}"><span class="calendar-plan-icon">${icon(selectedDay.working ? 'clock-3' : 'coffee')}</span><div><span>当前计划：</span><strong>${selectedDay.label}</strong></div></div>
      <dl class="calendar-day-facts"><div><dt>生效依据</dt><dd>${sourceLabel}</dd></div><div><dt>官方安排</dt><dd>${official.name ? `${official.name}${official.working ? '补班' : '放假'}` : official.covered ? '无特殊安排' : '该年未收录'}</dd></div><div><dt>计划作息</dt><dd>${selectedDay.working ? `${settings.start}–${settings.end}${settings.end < settings.start ? ' 次日' : ''}` : '休息日'}</dd></div></dl>
      <div class="calendar-day-actions" role="group" aria-label="调整所选日期"><button class="outline-button" data-calendar-override="work" ${selectedDay.source === 'manual' && selectedDay.working ? 'disabled' : ''}>${icon('check')} 设为工作</button><button class="outline-button" data-calendar-override="rest" ${selectedDay.source === 'manual' && !selectedDay.working ? 'disabled' : ''}>${icon('coffee')} 设为休息</button><button class="subtle-button" data-calendar-override="reset" ${selectedDay.source !== 'manual' ? 'disabled' : ''}>${icon('rotate-ccw')} 恢复默认</button></div>
      <p class="calendar-selection-note record-note">${selectedDay.source === 'fallback' ? '该年官方安排未收录，暂按每周作息。' : '手动安排优先于官方日历；恢复默认后按当前日历与每周作息。'}</p>
    </section></div>
    <details class="calendar-source"><summary>${icon('info')} 日历来源与计薪规则 ${icon('chevron-down')}</summary><div><p>已有班次及同日续班沿用打卡时的参数。放假标记不等于加班倍率，不自动改为三倍计薪。</p><p>${source ? `来源：国务院办公厅 ${source.title}，公布于 ${source.published}。` : ''}内置已核对安排：2025–2026 年；后续数据随软件版本更新。农历由系统日历转换，仅作日期参考。</p><p>中国大陆 · 日期与打卡均按设备本地时区。</p></div></details>
    </div>`;
}
