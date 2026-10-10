import { createIcons, LayoutDashboard, CalendarDays, Settings2, CircleHelp, ChevronDown, ChevronRight, Clock3, Wallet, Timer, Coffee, TrendingUp, ArrowUpRight, Pause, Play, Volume2, VolumeX, RotateCcw, X, Check, Coins, Info, Sparkles, Sun, Moon, Palette, PictureInPicture2, Plus, Trash2, Square, Download, Upload, History, Pin, PawPrint, CircleAlert } from 'lucide';
import './style.css';
import './themes.css';
import './settings-opacity.css';
import './breaks.css';
import './update-status.css';
import './evolution.css';
import './record-tools.css';
import './experience.css';
import './calendar.css';
import './experience-refinement.css';
import { ChevronLeft } from 'lucide';
import { CHINA_CALENDAR } from './china-calendar.js';
import { calendarView, moveMonth, validMonth } from './calendar-view.js';
import { mountSettingsNavigation } from './settings-navigation.js';
import { updateDigits } from './digit-motion.js';
import { updateCountedAmount } from './amount-counter.js';
import { calculateSchedule, dateKey } from './schedule.js';
import { defaults, settingsError } from './settings.js';
import { store } from './client-store.js';
import { activeRecord, currentCalculation, summaries } from './work-log.js';
import { workPresentation, hasPendingPaySettings, overtimeReminder, paySettingsRows } from './work-status.js';
import { createRecordTools } from './record-panel.js';
import { needsSetup, shiftExperience } from './experience-state.js';
import { mountOnboarding } from './onboarding.js';
import { mountAppearancePreview } from './appearance-preview.js';

const icons = { LayoutDashboard, CalendarDays, Settings2, CircleHelp, ChevronDown, ChevronRight, Clock3, Wallet, Timer, Coffee, TrendingUp, ArrowUpRight, Pause, Play, Volume2, VolumeX, RotateCcw, X, Check, Coins, Info, Sparkles, Sun, Moon, Palette, PictureInPicture2, Plus, Trash2, Square, Download, Upload, History, Pin, PawPrint, CircleAlert };
icons.ChevronLeft = ChevronLeft;
const themes = [{ id: 'minimal', label: '极简透明', icon: 'sun' }, { id: 'night', label: '夜晚模式', icon: 'moon' }, { id: 'hachiware', label: '定制小八', icon: 'palette' }];
let settings = (await store.init()).settings;
if (!themes.some(theme => theme.id === settings.theme)) settings.theme = defaults.theme;
document.body.dataset.theme = settings.theme;
let paused = false;
let frozenAt = null;
let offset = 0;
let activeView = 'today';
let audioContext;
let updateState = null;
let updateEvents = 0;
let drawerBaseline;
let drawerFocus;
let closeTimer;
let historyRange = 'month';
let historySignature = '';
let advancing = false;
let liveKey;
let reminderKey = '';
let reminderSnoozedUntil = 0;
let calendarSelected = dateKey(new Date());
let calendarMonth = calendarSelected.slice(0, 7);
let appearanceTheme;
let disposePreview;

async function patchSettings(patch, expected) {
  return store.dispatch({ type: 'settings', patch, expected });
}
async function attempt(task) {
  try { await task(); } catch (error) { toast(error.message || '操作失败，请重试'); }
}
function icon(name, cls = '') { return `<i data-lucide="${name}" class="${cls}"></i>`; }
function refreshIcons() { createIcons({ icons }); }
function returnToWidget() {
  if (window.paydropDesktop) window.paydropDesktop.showWidget();
  else window.location.href = new URL('./widget.html', window.location.href).href;
}
function widgetButton() { return `<button class="icon-button" data-return-widget title="返回挂件" aria-label="返回挂件">${icon('picture-in-picture-2')}</button>`; }
function themeControls(className) { return `<div class="${className}" role="group" aria-label="外观主题">${themes.map(theme => `<button type="button" class="theme-choice ${settings.theme === theme.id ? 'selected' : ''}" data-theme-choice="${theme.id}" aria-label="${theme.label}" title="${theme.label}" aria-pressed="${settings.theme === theme.id}">${icon(theme.icon)}<span>${theme.label}</span></button>`).join('')}</div>`; }
function opacityControls() {
  return `<div class="form-section-title">挂件外观</div>
    <div class="opacity-control"><div class="opacity-control-header"><label for="background-opacity">背景图不透明度</label><output for="background-opacity">${settings.backgroundOpacity}%</output></div><input id="background-opacity" name="backgroundOpacity" type="range" min="0" max="100" value="${settings.backgroundOpacity}"></div>
    <div class="opacity-control"><div class="opacity-control-header"><label for="widget-opacity">挂件整体不透明度</label><output for="widget-opacity">${settings.widgetOpacity}%</output></div><input id="widget-opacity" name="widgetOpacity" type="range" min="20" max="100" value="${settings.widgetOpacity}"></div>`;
}
async function chooseTheme(theme) {
  if (!themes.some(item => item.id === theme)) return;
  await patchSettings({ theme });
}
function pad(n) { return String(n).padStart(2, '0'); }
function money(n, digits = 2) { return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function duration(seconds, withSeconds = true) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return `${pad(h)}:${pad(m)}${withSeconds ? `:${pad(s)}` : ''}`;
}
function now() { return new Date(paused ? frozenAt : Date.now() + offset); }
function calculate(date = now()) { return currentCalculation(settings, store.data.records, date); }
function timelineSegments(c) {
  const segments = [];
  let position = c.start;
  for (const rest of c.breaks) {
    if (rest.from > position) segments.push({ type: 'work', from: position, to: rest.from });
    segments.push({ type: rest.paid ? 'paid-break' : 'break', from: rest.from, to: rest.to });
    position = rest.to;
  }
  if (position < c.end) segments.push({ type: 'work', from: position, to: c.end });
  return segments.map((item, index) => `<div class="timeline-${item.type} ${index === 0 ? 'timeline-segment-first' : ''} ${index === segments.length - 1 ? 'timeline-segment-last' : ''}" style="left:${(item.from - c.start) / (c.end - c.start) * 100}%;width:${(item.to - item.from) / (c.end - c.start) * 100}%"></div>`).join('');
}
function dateLabel(date) { return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date); }
function timeLabel(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }

function render() {
  disposePreview?.(); disposePreview = null;
  if (needsSetup(store.data)) {
    mountOnboarding(document.querySelector('#app'), settings, patchSettings, () => { render(); toast('计薪安排已保存'); });
    return;
  }
  const d = now(), c = calculate(d);
  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">${icon('coins')}</div><div><strong>薪动</strong><span>PAYDROP</span></div></div>
        <div class="workspace-label">工作台</div>
        <nav class="nav">
          <button class="nav-item ${activeView === 'today' ? 'active' : ''}" data-view="today">${icon('layout-dashboard')}<span>今日概览</span></button>
          <button class="nav-item ${activeView === 'insights' ? 'active' : ''}" data-view="insights">${icon('calendar-days')}<span>收入测算</span></button>
          <button class="nav-item ${activeView === 'history' ? 'active' : ''}" data-view="history">${icon('history')}<span>工作记录</span></button>
          <button class="nav-item ${activeView === 'calendar' ? 'active' : ''}" data-view="calendar">${icon('calendar-days')}<span>中国日历</span></button>
          <button class="nav-item" id="open-pet">${icon('paw-print')}<span>小八桌宠</span></button>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-note"><span class="note-icon">${icon('sparkles')}</span><strong>每一秒，都算数。</strong><p>认真工作，也认真看见自己的时间。</p></div>
          <button class="nav-item" id="open-settings-side">${icon('settings-2')}<span>薪资与作息设置</span></button>
          <button class="nav-item" id="open-help">${icon('circle-help')}<span>计算说明</span></button>
          <div class="profile"><div class="avatar">我</div><div><strong>我的工作台</strong><span>本地数据 · 仅存于此设备</span></div><span class="profile-dot"></span></div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="breadcrumb">工作台 <span>/</span> ${{ today: '今日概览', insights: '收入测算', history: '工作记录', calendar: '中国日历' }[activeView]}</div><div class="top-actions"><span class="today-date">${dateLabel(d)}</span><span class="header-divider"></span><button class="icon-button" id="sound-toggle" title="${settings.sound ? '关闭金币音效' : '开启金币音效'}" aria-label="金币音效">${icon(settings.sound ? 'volume-2' : 'volume-x')}</button><button class="icon-button" id="open-settings" title="设置" aria-label="设置">${icon('settings-2')}</button>${widgetButton()}</div></header>
        <nav class="mobile-nav" aria-label="页面导航"><button class="${activeView === 'today' ? 'active' : ''}" data-view="today">今日概览</button><button class="${activeView === 'insights' ? 'active' : ''}" data-view="insights">收入测算</button><button class="${activeView === 'history' ? 'active' : ''}" data-view="history">工作记录</button><button class="${activeView === 'calendar' ? 'active' : ''}" data-view="calendar">中国日历</button></nav>
        <div class="page-content">${activeView === 'today' ? todayView(c, d) : activeView === 'history' ? historyView() : activeView === 'calendar' ? calendarView(settings, calendarMonth, calendarSelected, icon) : insightsView(c)}</div>
      </main>
    </div>
    <div class="overlay" id="overlay" hidden></div>
    <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="薪资与作息设置" aria-hidden="true" inert></aside>
    <div class="toast" id="toast" role="status"></div>
  `;
  document.querySelector('.top-actions .header-divider').insertAdjacentHTML('beforebegin', themeControls('theme-toolbar'));
  refreshIcons();
  bind();
  updateLive();
}
function todayView(c, d) {
  const presentation = workPresentation(c);
  const experience = shiftExperience(c);
  return `<div class="today-surface"><div class="page-heading today-heading"><div><div class="eyebrow"><span class="live-dot"></span><span id="live-state">${c.mode === 'actual' ? '实际记录' : '作息估算'} · ${c.state}</span></div><h1 id="today-title">${experience.heading}</h1></div><button class="outline-button" id="quick-settings">${icon('settings-2')} 调整工作时间</button></div>
    <section class="historical-shift" id="historical-shift" ${experience.historical ? '' : 'hidden'}><div><strong>有历史班次尚未结束</strong><p id="historical-copy">以下数据属于 ${c.key} 班次，不是今日汇总。请核对真实结束时间后继续记录。</p></div><button type="button" class="outline-button" id="correct-historical">${icon('history')} 核对旧班次</button></section>
    <div id="work-controls" class="work-controls">${workControls(c)}</div>
    <p id="today-calendar" class="record-note"></p>
    <div id="overtime-reminder" class="overtime-reminder" hidden><div class="reminder-copy">${icon('circle-alert')}<p id="overtime-reminder-message" role="status"></p></div><div class="reminder-actions"><button type="button" id="correct-overtime" class="save-button">${icon('history')} 补填结束时间</button><button type="button" id="snooze-overtime" class="outline-button">${icon('check')} 仍在工作</button></div></div>
    <div id="snapshot-notice" class="snapshot-notice" hidden><span>本班与新设置不同，同日续班仍沿用本班参数。</span><button type="button" id="compare-pay-settings" class="text-link">${icon('settings-2')} 核对生效参数</button></div>
    <div class="display-frozen-note" ${paused ? '' : 'hidden'} role="status"><span>数字已冻结，打卡状态未改变</span><button type="button" class="text-link" id="resume-display">${icon('play')} 回到实时</button></div>
    <div class="dashboard-grid">
      <div class="primary-column">
        <section class="earnings-panel"><div class="panel-top"><span class="panel-kicker" id="earnings-label">${c.mode === 'actual' ? '本班已记录收入' : '今日预计收入'}</span><span class="earning-status"><span></span><b id="earning-state">${c.state}</b></span></div>
          <div class="earning-main"><div class="currency">¥</div><div class="earnings-number" id="earned-number">${money(c.earned, settings.amountPrecision)}</div><div class="coin-stage" id="coin-stage"><img class="dashboard-mascot" src="./hachiware-face.png" alt="小八角色头像" /></div></div>
          <div class="earning-footer"><span>${icon('trending-up')} <span id="earning-caption"></span></span><span>日薪 ¥${money(c.daily)}</span></div>
          <div class="schedule-progress" id="schedule-progress" ${experience.showProgress ? '' : 'hidden'}><div class="progress-caption"><span>计划班次进度 · 非收入进度</span><span id="progress-value">${Math.floor(experience.progress)}%</span></div><div class="earning-track" role="progressbar" aria-label="计划班次进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(experience.progress)}"><div id="earning-track-fill" style="width:${experience.progress}%"></div></div></div>
          <div class="panel-grain"></div>
        </section>
        <div class="metric-grid">
          <section class="metric-card countdown"><div class="metric-icon orange">${icon('timer')}</div><div class="metric-copy"><span id="remaining-label">${presentation.timerLabel}</span><strong id="remaining">${duration(presentation.timerSeconds)}</strong><small id="remaining-caption">${presentation.timerCaption}</small></div><div class="tiny-clock"><span class="clock-hand"></span></div></section>
          <section class="metric-card"><div class="metric-icon green">${icon('clock-3')}</div><div class="metric-copy"><span>已工作时长</span><strong id="worked">${duration(c.worked)}</strong><small>含加班与有薪计划休息</small></div></section>
          <section class="metric-card"><div class="metric-icon red">${icon('coffee')}</div><div class="metric-copy"><span id="rest-or-unpaid-label">${experience.resting ? experience.restLabel : '无偿打工时长'}</span><strong id="unpaid">${duration(experience.resting ? experience.restSeconds : c.unpaid)}</strong><small id="rest-or-unpaid-caption">${experience.resting ? experience.restCaption : '含提前工作与无薪加班'}</small></div></section>
        </div>
        <section class="timeline-section"><div class="section-title"><div><h2>本班时间轴</h2><p>${c.key} · ${c.mode === 'actual' ? '按打卡时的作息计算' : '按当前作息估算'}</p></div><span class="section-date">${dateLabel(d)}</span></div><div class="timeline-line">${timelineSegments(c)}<div class="timeline-now" id="timeline-now" style="left:${c.progress}%"><span></span></div></div><div class="timeline-labels"><div><b>${c.plan.start}</b><span>上班</span></div><div class="timeline-break-label"><b>${c.breaks.length ? c.breaks.map(rest => `${rest.start}–${rest.end}${rest.paid ? '（有薪）' : ''}`).join(' · ') : '无休息时段'}</b><span>${c.breaks.length} 段休息 · 无薪共 ${Math.round(c.breakTotal / 60)} 分钟</span></div><div><b>${c.plan.end}${c.end >= 86400 ? ' 次日' : ''}</b><span>下班</span></div></div><div class="legend"><span><i class="legend-dot working"></i> 工作时间</span><span><i class="legend-dot resting"></i> 无薪休息</span><span><i class="legend-dot paid-rest"></i> 有薪休息</span></div></section>
      </div>
      <div class="side-column">
        <section class="clock-panel"><div class="clock-top"><span>此刻时间</span>${icon('clock-3')}</div><strong id="current-time">${timeLabel(d)}</strong><span class="clock-date">${dateLabel(d)}</span><div class="clock-decoration"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div></section>
        <section class="rate-panel"><div class="section-title compact"><div><h2>标准秒薪</h2><p>${c.recordId ? '按本班打卡时的参数' : '按当前薪资与作息计算'}</p></div>${icon('wallet')}</div><div class="rate-row"><div class="rate-symbol">¥</div><strong id="rate-value">${money(c.rate, 4)}</strong><span>/ 秒</span></div><div class="rate-divider"></div><div class="rate-detail"><span>标准每分钟</span><strong>¥${money(c.rate * 60)}</strong></div><div class="rate-detail"><span>标准每小时</span><strong>¥${money(c.rate * 3600)}</strong></div><div class="rate-detail"><span>每工作日</span><strong>¥${money(c.daily)}</strong></div><button class="text-link" id="rate-settings">查看计算依据 ${icon('arrow-up-right')}</button></section>
        <section class="daily-panel"><div class="section-title compact"><div><h2>计划作息</h2><p>${c.key}</p></div></div><div class="daily-item"><span class="daily-marker start">${icon('play')}</span><div><strong>计划上班</strong><small>${c.plan.start}</small></div></div>${c.breaks.map((rest, index) => `<div class="daily-item"><span class="daily-marker break">${icon('coffee')}</span><div><strong>${rest.paid ? '有薪' : '无薪'}休息 ${index + 1}</strong><small>${rest.start}–${rest.end}</small></div><span class="item-time">${Math.round((rest.to - rest.from) / 60)} 分钟</span></div>`).join('')}<div class="daily-item"><span class="daily-marker finish">${icon('sparkles')}</span><div><strong>计划下班</strong><small>${c.plan.end}${c.end >= 86400 ? ' 次日' : ''}</small></div><span class="item-time">${c.current >= c.end ? '已到时间' : '待完成'}</span></div></section>
      </div>
    </div>
    <div class="bottom-bar"><span>${icon('info')} 金额仅供参考，实际薪资以劳动合同和发薪记录为准。</span><div><button id="pause-toggle" class="subtle-button" title="只冻结数字，不暂停打卡或计薪" aria-pressed="${paused}">${icon(paused ? 'play' : 'pause')} ${paused ? '恢复实时数字' : '冻结数字'}</button><span class="footer-separator"></span><button id="reset-clock" class="subtle-button" title="回到真实时间">${icon('rotate-ccw')} 回到现在</button></div></div></div>`;
}
function insightsView(c) {
  c = calculateSchedule(settings);
  const weekly = c.daily * settings.workdays.length;
  return `<div class="page-heading"><div><div class="eyebrow"><span class="live-dot"></span> 收入测算</div><h1>收入测算</h1><p>日薪 ¥${money(c.daily)} · 每周 ${settings.workdays.length} 个工作日</p></div><button class="outline-button" id="quick-settings">${icon('settings-2')} 调整计算参数</button></div>
    <div class="insights-layout"><section class="insight-hero"><span>标准秒薪</span><div>¥ <strong>${money(c.rate, 4)}</strong><small>/ 秒</small></div><p>每日 ${duration(c.scheduled, false)} 有薪时间</p><div class="insight-columns"><div><span>每分钟</span><strong>¥${money(c.rate * 60)}</strong></div><div><span>每小时</span><strong>¥${money(c.rate * 3600)}</strong></div><div><span>加班每小时</span><strong>¥${money(settings.paidOvertime ? c.rate * 3600 * settings.overtimeMultiplier : 0)}</strong></div></div></section>
    <div class="insight-right"><section class="insight-card"><div class="metric-icon green">${icon('wallet')}</div><span>日薪</span><strong>¥${money(c.daily)}</strong></section><section class="insight-card"><div class="metric-icon orange">${icon('calendar-days')}</div><span>常规工作周预估</span><strong>¥${money(weekly)}</strong><p>不含特殊日期和加班</p></section></div></div>
    <section class="formula-section"><h2>计算依据</h2><div class="formula-line"><span>日薪</span><b>÷</b><span>每日有薪秒数</span><b>=</b><strong>标准秒薪</strong></div><p>${settings.start}–${settings.end}${c.end > 86400 ? '（次日）' : ''}，扣除 ${Math.round(c.breakTotal / 60)} 分钟无薪休息。${settings.paidOvertime ? `主动记录的加班按 ${settings.overtimeMultiplier} 倍标准秒薪计算。` : '主动记录的加班按无薪统计。'}</p></section>`;
}
function workControls(c) {
  const record = activeRecord(store.data.records);
  const onBreak = record?.segments.at(-1)?.kind === 'break';
  const overtime = record?.segments.at(-1)?.kind === 'overtime' || record?.segments.at(-1)?.resumeKind === 'overtime';
  const mode = record ? 'actual' : settings.trackingMode;
  const start = c.isWorkday && Date.now() < c.endAt;
  return `<div class="mode-control" role="group" aria-label="计薪模式">
    <button type="button" data-tracking="estimate" aria-pressed="${mode === 'estimate'}" ${record ? 'disabled' : ''}>作息估算</button>
    <button type="button" data-tracking="actual" aria-pressed="${mode === 'actual'}" ${record ? 'disabled' : ''}>实际打卡</button>
    </div><span class="record-date">${c.mode === 'actual' ? `班次 ${c.key}` : c.isWorkday ? '计划工作日' : '休息日'}</span>
    <div class="session-actions">${record
      ? `<button class="outline-button" data-work-action="${onBreak ? 'resume' : 'break'}" title="${onBreak ? '继续记录工作，按本班参数计薪' : '休息期间不累计收入与工作时长'}">${icon(onBreak ? 'play' : 'coffee')} ${onBreak ? '继续工作' : '休息（不计薪）'}</button><button type="button" class="session-end outline-button" data-work-action="end">${icon('square')} ${overtime ? '结束加班' : '提前下班'}</button>`
      : mode === 'actual' ? `<button class="save-button" data-work-action="${start ? 'start' : 'overtime'}">${icon('play')} ${start ? '开始工作' : '开始加班'}</button>` : ''}</div>`;
}
function selectedHistory() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), historyRange === 'month' ? 1 : today.getDate() - (today.getDay() + 6) % 7);
  return summaries(store.data.records).filter(row => historyRange === 'all' || row.date >= dateKey(from));
}
function historyView() {
  const rows = selectedHistory();
  const total = rows.reduce((sum, row) => ({ earned: sum.earned + row.earned, worked: sum.worked + row.worked, unpaid: sum.unpaid + row.unpaid }), { earned: 0, worked: 0, unpaid: 0 });
  return `<div class="page-heading"><div><div class="eyebrow">${icon('history')} 实际记录</div><h1>工作记录</h1><p>${rows.length} 个班次 · 本地保存</p></div><div class="history-actions"><button class="outline-button" id="export-history" ${rows.length ? '' : 'disabled'}>${icon('download')} 导出 CSV</button><button class="save-button" id="add-record">${icon('plus')} 补录班次</button></div></div>
    <div class="history-toolbar"><div class="mode-control" role="group" aria-label="记录范围">${[['week', '本周'], ['month', '本月'], ['all', '全部']].map(([value, label]) => `<button data-history-range="${value}" aria-pressed="${historyRange === value}">${label}</button>`).join('')}</div><div class="history-actions"><button class="text-link" id="record-backup">${icon('download')} 完整备份</button><button class="text-link" id="recycle-records">${icon('trash-2')} 已删除 (${store.data.archivedRecords.length})</button></div></div>
    <div class="history-totals"><div><span>记录收入</span><strong>¥${money(total.earned)}</strong></div><div><span>工作时长</span><strong>${duration(total.worked)}</strong></div><div><span>无薪时长</span><strong>${duration(total.unpaid)}</strong></div></div>
    <div class="history-mobile">${rows.map(row => `<article><header><button class="record-detail-link" data-record-detail="${row.id}">${row.date}${icon('chevron-right')}</button><span class="record-status ${row.finished ? '' : 'active'}">${row.state}</span></header><dl><div><dt>收入</dt><dd>¥${money(row.earned)}</dd></div><div><dt>工作时长</dt><dd>${duration(row.worked)}</dd></div><div><dt>加班时长</dt><dd>${duration(row.overtime)}</dd></div><div><dt>无薪时长</dt><dd>${duration(row.unpaid)}</dd></div></dl><footer><button class="text-link" data-record-detail="${row.id}">核对详情 ${icon('chevron-right')}</button><button class="icon-button" data-delete-record="${row.id}" title="删除记录（可恢复）" aria-label="删除 ${row.date} 记录" ${row.finished ? '' : 'disabled'}>${icon('trash-2')}</button></footer></article>`).join('')}</div>
    ${rows.length ? `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>班次日期</th><th>收入（元）</th><th>工作时长</th><th>加班时长</th><th>无薪时长</th><th>状态</th><th><span class="sr-only">删除</span></th></tr></thead><tbody>${rows.map(row => `<tr><td><button class="record-detail-link" data-record-detail="${row.id}" title="查看班次详情">${row.date}${icon('chevron-right')}</button></td><td>${money(row.earned)}</td><td>${duration(row.worked)}</td><td>${duration(row.overtime)}</td><td>${duration(row.unpaid)}</td><td><span class="record-status ${row.finished ? '' : 'active'}">${row.state}</span></td><td><button class="icon-button" data-delete-record="${row.id}" title="删除记录（可恢复）" aria-label="删除 ${row.date} 记录" ${row.finished ? '' : 'disabled'}>${icon('trash-2')}</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="history-empty">${icon('calendar-days')}<h2>暂无打卡记录</h2><button class="outline-button" data-view="today">${icon('arrow-up-right')} 返回今日概览</button></div>`}`;
}
function downloadFile(name, content, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const recordTools = createRecordTools({ show: (content, label) => showDrawer(content, label, true), close: closeDrawer, icon, refreshIcons, toast, download: downloadFile });
function exportHistory() {
  const rows = selectedHistory();
  const text = ['班次日期,记录收入（元）,工作时长,加班时长,无薪时长,状态', ...rows.map(row => `${row.date},${row.earned.toFixed(4)},${duration(row.worked)},${duration(row.overtime)},${duration(row.unpaid)},${row.state}`)].join('\r\n');
  downloadFile(`Paydrop-${historyRange}-${dateKey(new Date())}.csv`, '\uFEFF' + text, 'text/csv;charset=utf-8');
}
function updateLive() {
  if (needsSetup(store.data)) return;
  const c = calculate(), d = now();
  const live = currentCalculation(settings, store.data.records, new Date());
  const presentation = workPresentation(paused ? live : c);
  const experience = shiftExperience(live);
  if (activeView === 'today' && liveKey !== c.key) { liveKey = c.key; refreshPage(); }
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const motion = settings.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  updateCountedAmount(document.getElementById('earned-number'), c.earned, motion && !paused, spawnCoin, settings.amountPrecision);
  const amount = document.getElementById('earned-number');
  if (amount) {
    const text = money(c.earned, settings.amountPrecision);
    const units = [...text].reduce((total, char) => total + (/\d/.test(char) ? .74 : .3), 0);
    const reserve = settings.theme === 'hachiware' ? 104 : 20;
    const available = amount.parentElement.clientWidth - amount.previousElementSibling.offsetWidth - 12 - reserve;
    amount.style.fontSize = `${Math.max(16, Math.min(56, Math.floor(available / units)))}px`;
  }
  updateDigits(document.getElementById('remaining'), duration(workPresentation(c).timerSeconds), motion && !paused, presentation.timerDirection);
  updateDigits(document.getElementById('worked'), duration(c.worked), motion);
  updateDigits(document.getElementById('unpaid'), duration(experience.resting ? c.restSeconds : c.unpaid), motion && !paused);
  set('rest-or-unpaid-label', experience.resting ? experience.restLabel : '无偿打工时长');
  set('rest-or-unpaid-caption', experience.resting ? experience.restCaption : '含提前工作与无薪加班');
  set('today-title', experience.heading);
  const historical = document.getElementById('historical-shift');
  if (historical) historical.hidden = !experience.historical;
  set('historical-copy', `以下数据属于 ${live.key} 班次，不是今日汇总。请核对真实结束时间后继续记录。`);
  updateDigits(document.getElementById('current-time'), timeLabel(d), motion);
  set('earning-caption', `${presentation.rateLabel} · ¥${money(presentation.rate, 4)} / 秒 · ${presentation.detail}`);
  set('remaining-label', presentation.timerLabel);
  set('remaining-caption', presentation.timerCaption);
  const notice = document.getElementById('snapshot-notice');
  const calendarNote = document.getElementById('today-calendar');
  if (calendarNote) {
    const day = live.calendarDay;
    calendarNote.textContent = `${live.key} · ${day.label}${day.source === 'fallback' ? ' · 该年官方日历未收录，暂按每周作息' : ''}${live.recordId ? ' · 按本班打卡时参数' : ''}`;
  }
  if (notice) notice.hidden = !c.recordId || !hasPendingPaySettings(c.plan, settings);
  updateOvertimeReminder();
  set('earning-state', live.state);
  set('live-state', `${live.mode === 'actual' ? '实际记录' : '作息估算'} · ${live.state}${live.recordId && live.key !== dateKey(new Date()) ? ` · 班次 ${live.key}` : ''}`);
  set('earnings-label', c.mode === 'actual' ? '本班已记录收入' : '今日预计收入');
  const finished = document.querySelector('.daily-item:last-child .item-time');
  if (finished) finished.textContent = c.state === '已下班' ? '已结束' : c.current >= c.end ? '已到下班时间' : '待完成';
  document.querySelectorAll('.today-date,.clock-date,.section-date').forEach(element => { element.textContent = dateLabel(d); });
  const controls = document.getElementById('work-controls');
  const signature = `${live.state}|${live.mode}|${live.key}|${Boolean(activeRecord(store.data.records))}`;
  if (controls && controls.dataset.signature !== signature) { controls.innerHTML = workControls(live); controls.dataset.signature = signature; refreshIcons(); }
  const progress = shiftExperience(c);
  const progressHost = document.getElementById('schedule-progress');
  if (progressHost) progressHost.hidden = !progress.showProgress;
  const track = document.getElementById('earning-track-fill');
  if (track) { track.style.width = `${progress.progress}%`; track.parentElement.setAttribute('aria-valuenow', Math.floor(progress.progress)); }
  set('progress-value', `${Math.floor(progress.progress)}%`);
  const marker = document.getElementById('timeline-now'); if (marker) marker.style.left = `${c.progress}%`;
  if (activeView === 'history') {
    const signature = `${store.data.revision}|${Math.floor(Date.now() / 15000)}`;
    if (historySignature !== signature) { historySignature = signature; refreshPage(); }
  }
}
function updateOvertimeReminder() {
  const banner = document.getElementById('overtime-reminder');
  if (!banner) return;
  // Reminders follow the real clock even when the earnings display is frozen.
  const reminder = overtimeReminder(activeRecord(store.data.records), settings);
  const key = reminder?.key || '';
  if (key !== reminderKey) { reminderKey = key; reminderSnoozedUntil = 0; }
  banner.hidden = !reminder || shiftExperience(currentCalculation(settings, store.data.records)).historical || Date.now() < reminderSnoozedUntil;
  const message = document.getElementById('overtime-reminder-message');
  const text = reminder?.message || '';
  if (message.textContent !== text) message.textContent = text;
}
function refreshPage() {
  const page = document.querySelector('.page-content');
  if (!page) return;
  const c = calculate();
  page.innerHTML = activeView === 'today' ? todayView(c, now()) : activeView === 'history' ? historyView() : activeView === 'calendar' ? calendarView(settings, calendarMonth, calendarSelected, icon) : insightsView(c);
  refreshIcons();
  bind();
}
function spawnCoin() {
  if (!settings.motion) return;
  const stage = document.getElementById('coin-stage'); if (!stage) return;
  const coin = document.createElement('span'); coin.className = 'falling-coin'; coin.textContent = '¥';
  coin.style.left = `${25 + Math.random() * 55}%`; coin.style.setProperty('--drift', `${(Math.random() - .5) * 50}px`);
  stage.appendChild(coin); coin.addEventListener('animationend', () => coin.remove());
  if (settings.sound) playCoinSound();
}
function playCoinSound() {
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audioContext.createOscillator(), g = audioContext.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(740, audioContext.currentTime); o.frequency.exponentialRampToValueAtTime(1100, audioContext.currentTime + .09); g.gain.setValueAtTime(.025, audioContext.currentTime); g.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .17); o.connect(g).connect(audioContext.destination); o.start(); o.stop(audioContext.currentTime + .17); } catch {}
}
function toast(text) { const el = document.getElementById('toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800); }
function showUpdateState() {
  const status = document.getElementById('update-message');
  if (!status || !updateState) return;
  const { phase, currentVersion, availableVersion, percent } = updateState;
  document.getElementById('app-version').textContent = `v${currentVersion}`;
  status.textContent = ({
    idle: '后台会自动检查更新',
    checking: '正在检查更新…',
    current: '已是最新版本',
    downloading: `正在下载 v${availableVersion} · ${percent ?? 0}%`,
    ready: `v${availableVersion} 已就绪`,
    installing: '正在重启安装…',
    error: updateState.errorMessage || '检查失败，请查看诊断日志',
    unavailable: '此版本不支持自动更新',
  })[phase] || '后台会自动检查更新';
  const check = document.getElementById('check-update');
  check.hidden = ['ready', 'installing', 'unavailable'].includes(phase);
  check.disabled = ['checking', 'downloading'].includes(phase);
  document.getElementById('install-update').hidden = phase !== 'ready';
}
function updateSettings() {
  if (!window.paydropDesktop?.getUpdateState) return '';
  return `<div class="form-section-title">软件更新</div>
    <div class="update-settings"><div><strong>当前版本 <span id="app-version"></span></strong><span id="update-message" role="status">正在读取版本…</span></div>
    <button type="button" class="add-break" id="check-update">检查更新</button>
    <button type="button" class="save-button" id="install-update" hidden>重启更新</button></div>
    <button type="button" class="text-link" id="update-log">${icon('info')} 查看更新日志</button>`;
}
function showDrawer(content, label, wide = false) {
  disposePreview?.(); disposePreview = null;
  clearTimeout(closeTimer);
  const drawer = document.getElementById('drawer'), overlay = document.getElementById('overlay');
  if (!drawer.classList.contains('open')) drawerFocus = document.activeElement;
  drawer.classList.toggle('record-drawer', wide);
  drawer.onclick = null;
  drawer.inert = false;
  document.querySelector('.app-shell').inert = true;
  drawer.setAttribute('aria-label', label);
  drawer.innerHTML = content;
  drawer.querySelector('.close-drawer').insertAdjacentHTML('beforebegin', widgetButton());
  overlay.hidden = false;
  requestAnimationFrame(() => { overlay.classList.add('visible'); drawer.classList.add('open'); drawer.querySelector('.close-drawer').focus(); });
  drawer.setAttribute('aria-hidden', 'false');
  drawer.querySelector('[data-return-widget]').onclick = returnToWidget;
  drawer.querySelector('.close-drawer').onclick = closeDrawer;
  refreshIcons();
  return drawer;
}
function openDrawer(kind = 'settings') {
  if (needsSetup(store.data)) return;
  drawerBaseline = structuredClone(settings);
  appearanceTheme = settings.theme;
  const content = kind === 'help' ? `<div class="drawer-header"><div><span>帮助</span><h2>计算说明</h2></div><button class="icon-button close-drawer" aria-label="关闭">${icon('x')}</button></div><div class="drawer-body help-body"><h3>秒薪怎么算？</h3><p>日薪 ÷ 每日有薪秒数。仅无薪计划休息会从有薪时间中扣除；有薪休息继续计薪。</p><h3>估算与实际记录</h3><p>作息估算按照计划时间计算，不会进入工作记录。实际记录按打卡时间累计，普通班次到计划下班时自动结束；只有主动开始的加班才会累计。每个班次沿用首次打卡时的薪资与作息。</p><h3>无薪时长是什么？</h3><p>包含计划上班前的提前工作和未开启加班计薪的已记录加班。计划无薪休息、临时休息不算工作，也不算无薪加班。</p><h3>跨午夜的班次</h3><p>下班时间早于上班时间时，下班归于次日，记录归属上班日期。普通班次自动结束；跨日加班需要主动结束。</p><h3>冻结数字与工作休息</h3><p>冻结数字不结束打卡或暂停计薪，小八休息也不会改变打卡。临时离开请使用“休息（不计薪）”；继续工作时按本班参数计薪。</p><h3>修正与备份</h3><p>工作记录中可核对实际时段，修正须填写真实结束时间并确认变更；原始时段与本班参数保留。删除的班次可在“已删除”中恢复。配置备份不含记录，完整备份包含配置、全部记录与修订历史；恢复完整备份前须结束当前班次。</p><div class="help-note">金额仅供参考，以劳动合同和发薪记录为准。</div></div>` : settingsForm();
  const drawer = showDrawer(content, kind === 'help' ? '计算说明' : '薪资与作息设置');
  if (kind === 'settings') {
    drawer.querySelector('#settings-appearance').innerHTML = `<div class="form-section-title">外观主题</div>${themeControls('theme-picker')}${opacityControls()}`;
    refreshIcons();
    drawer.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => {
      appearanceTheme = button.dataset.themeChoice;
      drawer.querySelectorAll('[data-theme-choice]').forEach(item => {
        item.classList.toggle('selected', item.dataset.themeChoice === appearanceTheme);
        item.setAttribute('aria-pressed', String(item.dataset.themeChoice === appearanceTheme));
      });
      drawer.querySelector('#settings-form').dispatchEvent(new Event('input', { bubbles: true }));
    });
    drawer.querySelectorAll('.opacity-control input').forEach(input => {
      input.oninput = () => { input.closest('.opacity-control').querySelector('output').value = `${input.value}%`; };
    });
    const list = drawer.querySelector('#break-list');
    drawer.querySelector('#add-break').onclick = () => {
      list.insertAdjacentHTML('beforeend', breakRow({ start: '', end: '', paid: false }, list.children.length));
      refreshIcons();
      updateSettingsImpact();
      list.lastElementChild.querySelector('input').focus();
    };
    list.onclick = event => {
      const button = event.target.closest('[data-remove-break]');
      if (!button) return;
      button.closest('.break-row').remove();
      [...list.children].forEach((row, index) => {
        row.querySelector('.break-index').textContent = index + 1;
        row.querySelector('[name="breakStart"]').setAttribute('aria-label', `第 ${index + 1} 段休息开始`);
        row.querySelector('[name="breakEnd"]').setAttribute('aria-label', `第 ${index + 1} 段休息结束`);
        row.querySelector('[data-remove-break]').setAttribute('aria-label', `删除第 ${index + 1} 段休息`);
      });
      updateSettingsImpact();
    };
    const check = drawer.querySelector('#check-update');
    if (check) check.onclick = () => window.paydropDesktop.checkForUpdates().catch(() => toast('检查更新失败'));
    const install = drawer.querySelector('#install-update');
    if (install) install.onclick = () => window.paydropDesktop.installUpdate();
    const logButton = drawer.querySelector('#update-log');
    if (logButton) logButton.onclick = () => attempt(async () => { const error = await window.paydropDesktop.openUpdateLog(); if (error) throw new Error(error); });
    drawer.querySelector('#add-exception').onclick = () => {
      drawer.querySelector('#exception-list').insertAdjacentHTML('beforeend', exceptionRow({ date: dateKey(new Date()), working: false }));
      refreshIcons();
      updateSettingsImpact();
    };
    drawer.querySelector('#exception-list').onclick = event => {
      event.target.closest('[data-remove-exception]')?.closest('.exception-row').remove();
      updateSettingsImpact();
    };
    drawer.querySelector('#export-config').onclick = () => downloadFile(`Paydrop-settings-${dateKey(new Date())}.json`, JSON.stringify({ schemaVersion: 3, settings }, null, 2));
    drawer.querySelector('#import-config').onclick = () => drawer.querySelector('#config-file').click();
    drawer.querySelector('#manage-data').onclick = () => {
      if (!confirm('打开备份中心将离开设置，未保存的设置不会保留。继续？')) return;
      recordTools.backup();
    };
    drawer.querySelector('#config-file').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      await attempt(async () => {
        if (file.size > 1024 * 1024) throw new Error('配置文件须小于 1 MB。');
        let parsed;
        try { parsed = JSON.parse(await file.text()); } catch { throw new Error('配置文件不是有效 JSON。'); }
        if (parsed?.format === 'PaydropBackup') throw new Error('这是完整备份，请从“完整数据备份与恢复”导入。');
        if (!confirm('导入会替换当前设置，工作记录不会改变。是否继续？')) return;
        await store.dispatch({ type: 'import-settings', settings: parsed.settings || parsed });
        closeDrawer(); render(); toast('配置已导入');
      });
      event.target.value = '';
    };
    showUpdateState();
  }
  drawer.querySelector('.close-drawer').onclick = closeDrawer;
  if (kind === 'settings') {
    drawer.querySelector('#settings-form').onsubmit = saveSettings;
    mountSettingsNavigation(drawer.querySelector('#settings-form'));
    drawer.querySelector('#settings-form').addEventListener('input', updateSettingsImpact);
    drawer.querySelector('#settings-form').addEventListener('change', updateSettingsImpact);
    updateSettingsImpact();
    drawer.querySelector('#reset-defaults').onclick = () => attempt(async () => {
      if (!confirm('恢复默认设置？工作记录会保留。')) return;
      await patchSettings({ ...structuredClone(defaults), setupComplete: true }); closeDrawer(); render(); toast('已恢复默认设置');
    });
    disposePreview = mountAppearancePreview(drawer.querySelector('#settings-form'), () => readSettingsForm(drawer.querySelector('#settings-form')));
  }
}
function breakRow(rest, index) {
  return `<div class="break-row">
    <span class="break-index" aria-hidden="true">${index + 1}</span>
    <label class="field">开始<input name="breakStart" type="time" value="${rest.start}" required aria-label="第 ${index + 1} 段休息开始"></label>
    <label class="field">结束<input name="breakEnd" type="time" value="${rest.end}" required aria-label="第 ${index + 1} 段休息结束"></label>
    <label class="paid-break-check" title="此休息是否计薪"><input type="checkbox" name="breakPaid" ${rest.paid ? 'checked' : ''}>有薪</label>
    <button type="button" class="icon-button remove-break" data-remove-break title="删除休息时段" aria-label="删除第 ${index + 1} 段休息">${icon('trash-2')}</button>
  </div>`;
}
function exceptionRow(item) {
  return `<div class="exception-row"><input type="date" name="exceptionDate" value="${item.date}" required aria-label="特殊日期"><select name="exceptionWorking" aria-label="特殊日期类型"><option value="false" ${!item.working ? 'selected' : ''}>休息日</option><option value="true" ${item.working ? 'selected' : ''}>工作日</option></select><button type="button" class="icon-button" data-remove-exception title="删除日期" aria-label="删除特殊日期">${icon('trash-2')}</button></div>`;
}
function settingsForm() {
  return `<div class="drawer-header"><div><span>偏好设置</span><h2>设置</h2></div><button class="icon-button close-drawer" aria-label="关闭">${icon('x')}</button></div>
  <form id="settings-form">
  <div class="settings-tabs" role="tablist" aria-label="设置分类">${[['pay', '计薪与作息'], ['appearance', '外观与桌宠'], ['desktop', '提醒与桌面'], ['data', '数据与更新']].map(([id, label]) => `<button type="button" role="tab" id="settings-tab-${id}" data-settings-tab="${id}" aria-controls="settings-panel-${id}">${label}</button>`).join('')}</div>
  <div class="drawer-body">
  <section role="tabpanel" id="settings-panel-pay" aria-labelledby="settings-tab-pay" data-settings-panel="pay">
    <div class="form-section-title">薪资信息</div>
    <div id="settings-pay-impact" class="settings-pay-impact"></div>
    <div class="field-grid"><label class="field">日薪（元）<input name="dailySalary" type="number" min="0.01" step="0.01" value="${settings.dailySalary}" required></label></div>
    <div class="form-section-title">每日作息</div>
    <div class="field-grid"><label class="field">上班时间<input name="start" type="time" value="${settings.start}" required></label><label class="field">下班时间<input name="end" type="time" value="${settings.end}" required></label></div>
    <div class="form-section-title">每周工作日</div>
    <label class="field">工作日历<select name="workCalendar"><option value="weekly" ${settings.workCalendar !== CHINA_CALENDAR ? 'selected' : ''}>仅按每周作息</option><option value="${CHINA_CALENDAR}" ${settings.workCalendar === CHINA_CALENDAR ? 'selected' : ''}>中国大陆节假日与调休（2025–2026）</option></select></label>
    <p class="record-note">手动特殊日期优先；官方放假和补班优先于每周作息。未收录年份按每周作息，已有班次不变。</p>
    <div class="weekday-picker">${[[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日']].map(([day, name]) => `<label><input type="checkbox" name="workday" value="${day}" ${settings.workdays.includes(day) ? 'checked' : ''}><span>周${name}</span></label>`).join('')}</div>
    <div class="break-heading"><div class="form-section-title">特殊日期</div><button type="button" class="add-break" id="add-exception">${icon('plus')} 添加日期</button></div>
    <div id="exception-list">${settings.exceptions.map(exceptionRow).join('')}</div>
    <div class="break-heading"><div class="form-section-title">休息时段</div><button type="button" class="add-break" id="add-break">${icon('plus')} 添加休息</button></div>
    <div id="break-list" class="break-list">${settings.breaks.map(breakRow).join('')}</div>
    <div class="form-section-title">计薪偏好</div>
    <div class="field-grid"><label class="field">计薪模式<select name="trackingMode"><option value="estimate" ${settings.trackingMode === 'estimate' ? 'selected' : ''}>作息估算</option><option value="actual" ${settings.trackingMode === 'actual' ? 'selected' : ''}>实际打卡</option></select></label><label class="field">加班倍率<input name="overtimeMultiplier" type="number" min="1" max="5" step="0.1" value="${settings.overtimeMultiplier}" required></label></div>
    <label class="switch-row"><div><strong>加班计薪</strong><span>主动记录的加班按设定倍率计薪</span></div><input name="paidOvertime" type="checkbox" ${settings.paidOvertime ? 'checked' : ''}><i></i></label>
  </section>
  <section role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance" data-settings-panel="appearance" hidden>
    <figure class="appearance-preview"><figcaption><strong>挂件预览</strong><span>示例数据 · 保存后生效</span></figcaption><div id="preview-stage" class="preview-stage"><iframe id="appearance-preview" src="./widget.html?preview=1" title="挂件外观预览" tabindex="-1"></iframe></div><output id="preview-size"></output></figure>
    <div id="settings-appearance"></div>
    <label class="switch-row"><div><strong>金币音效</strong><span>金币掉落时播放轻提示音</span></div><input name="sound" type="checkbox" ${settings.sound ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>动态效果</strong><span>显示金币掉落与数字过渡</span></div><input name="motion" type="checkbox" ${settings.motion ? 'checked' : ''}><i></i></label>
    <div class="form-section-title">数字与布局</div>
    <label class="field">挂件布局<select name="widgetDensity"><option value="compact" ${settings.widgetDensity === 'compact' ? 'selected' : ''}>紧凑 · 收入与倒计时</option><option value="standard" ${settings.widgetDensity === 'standard' ? 'selected' : ''}>标准 · 完整时长</option></select></label>
    <div class="field-grid"><label class="field">金额小数位<select name="amountPrecision"><option value="2" ${settings.amountPrecision === 2 ? 'selected' : ''}>2 位</option><option value="4" ${settings.amountPrecision === 4 ? 'selected' : ''}>4 位</option></select></label><label class="field">挂件缩放（%）<input name="widgetScale" type="number" min="80" max="150" step="5" value="${settings.widgetScale}" required></label></div>
    <div class="form-section-title">小八桌宠</div>
    <label class="switch-row"><div><strong>挂件内小八</strong></div><input name="widgetPetEnabled" type="checkbox" ${settings.widgetPetEnabled ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>独立桌宠</strong></div><input name="petEnabled" type="checkbox" ${settings.petEnabled ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>自由散步</strong></div><input name="petRoam" type="checkbox" ${settings.petRoam ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>跟随工作与休息</strong></div><input name="petFollowWork" type="checkbox" ${settings.petFollowWork ? 'checked' : ''}><i></i></label>
    <div class="field-grid"><label class="field">桌宠大小（%）<input name="petScale" type="number" min="70" max="140" step="5" value="${settings.petScale}" required></label><label class="field">桌宠不透明度（%）<input name="petOpacity" type="number" min="30" max="100" step="5" value="${settings.petOpacity}" required></label></div>
  </section>
  <section role="tabpanel" id="settings-panel-desktop" aria-labelledby="settings-tab-desktop" data-settings-panel="desktop" hidden>
    <div class="form-section-title">加班提醒</div>
    <label class="switch-row"><div><strong>长时加班提醒</strong></div><input name="overtimeReminderEnabled" type="checkbox" ${settings.overtimeReminderEnabled ? 'checked' : ''}><i></i></label>
    <label class="field">加班记录持续多少小时后提醒<input name="overtimeReminderHours" type="number" min="1" max="24" step="1" value="${settings.overtimeReminderHours}" required></label>
    <div class="form-section-title">桌面行为</div>
    <label class="switch-row"><div><strong>挂件始终置顶</strong></div><input name="alwaysOnTop" type="checkbox" ${settings.alwaysOnTop ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>关闭时收起到托盘</strong></div><input name="closeToTray" type="checkbox" ${settings.closeToTray ? 'checked' : ''}><i></i></label>
  </section>
  <section role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data" data-settings-panel="data" hidden>
    <div class="form-section-title">数据备份</div>
    <button type="button" class="outline-button" id="manage-data">${icon('history')} 完整数据备份与恢复</button>
    <p class="record-note">完整备份包含配置、班次、修订历史及已删除记录。</p>
    <div class="form-section-title">配置备份</div><div class="config-actions"><button type="button" class="outline-button" id="export-config">${icon('download')} 导出配置</button><button type="button" class="outline-button" id="import-config">${icon('upload')} 导入配置</button><input id="config-file" type="file" accept=".json,application/json" hidden></div>
    <p class="record-note">配置文件不含工作记录；导出使用已保存的设置。</p>
    ${updateSettings()}
  </section>
    <div class="form-error" id="form-error" role="alert"></div>
  </div><div class="drawer-footer"><button type="button" class="subtle-button" id="reset-defaults">恢复默认</button><button type="submit" class="save-button">${icon('check')} 保存设置</button></div></form>`;
}
function readSettingsForm(element) {
  const form = new FormData(element);
  const ends = form.getAll('breakEnd');
  const paidChecks = [...element.querySelectorAll('[name="breakPaid"]')];
  const breaks = form.getAll('breakStart').map((start, index) => ({ start, end: ends[index], ...(paidChecks[index].checked ? { paid: true } : {}) }));
  const working = form.getAll('exceptionWorking');
  return { ...drawerBaseline, dailySalary: Number(form.get('dailySalary')), start: form.get('start'), end: form.get('end'), breaks,
    workdays: form.getAll('workday').map(Number), workCalendar: form.get('workCalendar'), exceptions: form.getAll('exceptionDate').map((date, index) => ({ date, working: working[index] === 'true' })),
    trackingMode: form.get('trackingMode'), overtimeMultiplier: Number(form.get('overtimeMultiplier')),
    overtimeReminderEnabled: form.has('overtimeReminderEnabled'), overtimeReminderHours: Number(form.get('overtimeReminderHours')),
    paidOvertime: form.has('paidOvertime'), sound: form.has('sound'), motion: form.has('motion'), theme: appearanceTheme ?? settings.theme,
    backgroundOpacity: Number(form.get('backgroundOpacity')), widgetOpacity: Number(form.get('widgetOpacity')),
    amountPrecision: Number(form.get('amountPrecision')), widgetScale: Number(form.get('widgetScale')), widgetDensity: form.get('widgetDensity'),
    alwaysOnTop: form.has('alwaysOnTop'), closeToTray: form.has('closeToTray'),
    widgetPetEnabled: form.has('widgetPetEnabled'), petEnabled: form.has('petEnabled'), petRoam: form.has('petRoam'), petFollowWork: form.has('petFollowWork'),
    petScale: Number(form.get('petScale')), petOpacity: Number(form.get('petOpacity')) };
}
function updateSettingsImpact() {
  const host = document.getElementById('settings-pay-impact');
  if (!host || document.getElementById('drawer').inert) return;
  const next = readSettingsForm(document.getElementById('settings-form'));
  const current = currentCalculation({ ...settings, trackingMode: 'actual' }, store.data.records, new Date());
  const record = store.data.records.find(item => item.id === current.recordId);
  const draft = hasPendingPaySettings(settings, next);
  const error = settingsError(next);
  const note = document.createElement('p');
  note.className = 'settings-effect-note';
  note.textContent = record
    ? `${record.date} 班次及同日续班保持原参数；${!activeRecord(store.data.records) && next.trackingMode === 'estimate' ? '作息估算保存后使用新参数' : `${draft ? '待保存的参数' : '已保存的新参数'}用于新班次`}。`
    : next.trackingMode === 'estimate' ? '保存后用于当前作息估算；已有打卡记录保持不变。' : '保存后用于新班次；已有记录及同日续班保持原参数。';
  const immediate = document.createElement('p');
  immediate.className = 'settings-effect-note';
  immediate.textContent = '本面板的修改保存后生效，已有记录保持不变。';
  if (error) {
    const invalid = document.createElement('p');
    invalid.className = 'settings-effect-note';
    invalid.textContent = `参数预览待完善：${error}`;
    host.replaceChildren(note, immediate, invalid);
    return;
  }
  const details = document.createElement('details');
  details.className = 'pay-comparison';
  const rows = paySettingsRows(record?.settings || null, next);
  const differences = rows.filter(row => row.changed);
  details.open = differences.length > 0;
  const summary = document.createElement('summary');
  summary.textContent = record ? `本班与新参数对照${differences.length ? ` · ${differences.length} 项不同` : ' · 参数一致'}` : '计薪参数预览';
  const list = document.createElement('dl');
  for (const row of differences.length ? differences : rows) {
    const item = document.createElement('div');
    item.className = row.changed ? 'pay-setting-row changed' : 'pay-setting-row';
    const label = document.createElement('dt'); label.textContent = row.label;
    item.append(label);
    for (const [title, value] of [...(record ? [['本班', row.current]] : []), [draft ? '待保存' : '新班次', row.next]]) {
      const cell = document.createElement('dd');
      const name = document.createElement('span'); name.textContent = title;
      const content = document.createElement('strong'); content.textContent = value;
      cell.append(name, content); item.append(cell);
    }
    list.append(item);
  }
  details.append(summary, list);
  host.replaceChildren(note, immediate, details);
}
async function saveSettings(event) {
  event.preventDefault();
  const next = readSettingsForm(event.currentTarget);
  const error = settingsError(next);
  if (error) { document.getElementById('form-error').textContent = error; return; }
  const patch = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(drawerBaseline[key])));
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try { await patchSettings(patch, drawerBaseline); closeDrawer(); render(); toast('设置已保存；已有班次及同日续班仍沿用原参数'); }
  catch (error) { document.getElementById('form-error').textContent = error.message || '保存失败，请重试'; }
  finally { if (button.isConnected) button.disabled = false; }
}
function closeDrawer() { disposePreview?.(); disposePreview = null; const drawer = document.getElementById('drawer'), overlay = document.getElementById('overlay'); drawer.classList.remove('open'); drawer.inert = true; document.querySelector('.app-shell').inert = false; overlay.classList.remove('visible'); drawer.setAttribute('aria-hidden', 'true'); if (drawerFocus?.isConnected) drawerFocus.focus(); else document.getElementById('open-settings').focus(); clearTimeout(closeTimer); closeTimer = setTimeout(() => { overlay.hidden = true; }, 260); }
function bind() {
  bindCalendar();
  document.querySelector('.topbar [data-return-widget]').onclick = returnToWidget;
  document.querySelectorAll('.theme-toolbar [data-theme-choice]').forEach(button => button.onclick = () => attempt(() => chooseTheme(button.dataset.themeChoice)));
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { activeView = button.dataset.view; render(); });
  ['open-settings', 'open-settings-side', 'quick-settings', 'rate-settings', 'compare-pay-settings'].forEach(id => { const el = document.getElementById(id); if (el) el.onclick = () => openDrawer(); });
  document.getElementById('open-help').onclick = () => openDrawer('help');
  document.getElementById('open-pet').onclick = () => {
    if (window.paydropDesktop) window.paydropDesktop.showPet();
    else window.location.href = new URL('./pet.html', window.location.href).href;
  };
  document.getElementById('overlay').onclick = closeDrawer;
  document.getElementById('sound-toggle').onclick = () => attempt(async () => { await patchSettings({ sound: !settings.sound }); toast(settings.sound ? '金币音效已开启' : '金币音效已关闭'); });
  const pauseButton = document.getElementById('pause-toggle'); if (pauseButton) pauseButton.onclick = () => { if (paused) { paused = false; frozenAt = null; } else { frozenAt = Date.now() + offset; paused = true; } render(); toast(paused ? '数字已冻结，打卡与计薪未暂停' : '已恢复实时数字'); };
  const resumeDisplay = document.getElementById('resume-display');
  if (resumeDisplay) resumeDisplay.onclick = () => { paused = false; frozenAt = null; render(); };
  const reset = document.getElementById('reset-clock'); if (reset) reset.onclick = () => { offset = 0; paused = false; frozenAt = null; render(); toast('已回到当前时间'); };
  const snooze = document.getElementById('snooze-overtime');
  if (snooze) snooze.onclick = () => {
    const reminder = overtimeReminder(activeRecord(store.data.records), settings);
    if (!reminder) return;
    reminderKey = reminder.key; reminderSnoozedUntil = Date.now() + 3600000;
    updateOvertimeReminder();
    toast('已确认仍在工作，本窗口 1 小时后再提醒；记录未改变');
  };
  const correct = document.getElementById('correct-overtime');
  if (correct) correct.onclick = () => {
    const record = activeRecord(store.data.records);
    if (record) recordTools.editor(record.id, { finishOnly: true });
    else toast('此班次已结束，请查看工作记录。');
  };
  const historical = document.getElementById('correct-historical');
  if (historical) historical.onclick = () => {
    const record = activeRecord(store.data.records);
    if (record) recordTools.editor(record.id, { finishOnly: true });
  };
}
function bindCalendar() {
  const enable = document.getElementById('calendar-enable');
  if (!enable) return;
  enable.onchange = () => attempt(async () => {
    const next = enable.checked ? CHINA_CALENDAR : 'weekly';
    enable.disabled = true;
    try {
      await patchSettings({ workCalendar: next }, { workCalendar: settings.workCalendar });
      toast('工作日历已保存；已有班次及同日续班保持不变');
    } finally {
      if (enable.isConnected) { enable.disabled = false; enable.checked = settings.workCalendar === CHINA_CALENDAR; }
    }
  });
  document.querySelectorAll('[data-calendar-step]').forEach(button => {
    button.onclick = () => {
      calendarMonth = moveMonth(calendarMonth, Number(button.dataset.calendarStep));
      calendarSelected = `${calendarMonth}-01`;
      refreshPage();
      document.querySelector(`[data-calendar-step="${button.dataset.calendarStep}"]`)?.focus();
    };
  });
  document.getElementById('calendar-month').onchange = event => {
    if (!validMonth(event.target.value)) { event.target.value = calendarMonth; return; }
    calendarMonth = event.target.value; calendarSelected = `${calendarMonth}-01`;
    refreshPage(); document.getElementById('calendar-month').focus();
  };
  document.getElementById('calendar-today').onclick = () => {
    calendarSelected = dateKey(new Date()); calendarMonth = calendarSelected.slice(0, 7);
    refreshPage(); document.querySelector(`[data-calendar-day="${calendarSelected}"]`)?.focus();
  };
  document.querySelectorAll('[data-calendar-day]').forEach(button => {
    button.onclick = () => {
      calendarSelected = button.dataset.calendarDay;
      refreshPage(); document.querySelector(`[data-calendar-day="${calendarSelected}"]`)?.focus();
    };
  });
  document.querySelectorAll('[data-calendar-override]').forEach(button => {
    button.onclick = () => attempt(async () => {
      const expected = structuredClone(settings.exceptions);
      const exceptions = expected.filter(item => item.date !== calendarSelected);
      if (button.dataset.calendarOverride !== 'reset') exceptions.push({ date: calendarSelected, working: button.dataset.calendarOverride === 'work' });
      exceptions.sort((a, b) => a.date.localeCompare(b.date));
      button.disabled = true;
      try {
        await patchSettings({ exceptions }, { exceptions: expected });
        toast('日期安排已保存；已有班次保持不变');
      } finally { if (button.isConnected) button.disabled = false; }
    });
  });
}
document.addEventListener('click', event => {
  const work = event.target.closest('[data-work-action]');
  if (work && !work.disabled) attempt(async () => {
    const action = work.dataset.workAction;
    let expectedRecordId;
    if (action === 'end') {
      const record = activeRecord(store.data.records);
      const last = record?.segments.at(-1);
      if (!last) return;
      expectedRecordId = record.id;
      const overtime = last.kind === 'overtime' || last.resumeKind === 'overtime';
      const message = overtime ? '确认结束本次加班？' : '确认提前下班？正常班次会在计划下班时间自动结束。';
      if (!confirm(`${message}\n结束后将停止计薪并保存当前记录；临时离开请使用“休息（不计薪）”。`)) return;
    }
    await store.dispatch({ type: 'work', action, ...(expectedRecordId ? { expectedRecordId } : {}) });
    if (paused) { paused = false; frozenAt = null; render(); }
    toast(({ start: '工作记录已开始', overtime: '加班记录已开始', break: '已开始临时无薪休息', resume: '已继续工作', end: '工作已结束，记录已保存' })[action]);
  });
  const mode = event.target.closest('[data-tracking]');
  if (mode && !mode.disabled) attempt(() => patchSettings({ trackingMode: mode.dataset.tracking }));
  const range = event.target.closest('[data-history-range]');
  if (range) { historyRange = range.dataset.historyRange; refreshPage(); }
  if (event.target.closest('#export-history')) exportHistory();
  const detail = event.target.closest('[data-record-detail]');
  if (detail) recordTools.detail(detail.dataset.recordDetail);
  if (event.target.closest('#add-record')) recordTools.editor();
  if (event.target.closest('#recycle-records')) recordTools.recycle();
  if (event.target.closest('#record-backup')) recordTools.backup();
  const remove = event.target.closest('[data-delete-record]');
  if (remove && !remove.disabled) attempt(async () => {
    const expected = structuredClone(store.data.records.find(record => record.id === remove.dataset.deleteRecord));
    if (!expected || !confirm('将此班次移入已删除记录？可随时恢复，暂不计入汇总。')) return;
    await store.dispatch({ type: 'delete-record', id: expected.id, expected });
    toast('已移入已删除记录，可从工作记录中恢复');
  });
});
document.addEventListener('keydown', event => {
  const drawer = document.getElementById('drawer');
  if (!drawer?.classList.contains('open')) return;
  if (event.key === 'Escape') closeDrawer();
  if (event.key === 'Tab') {
    const focusable = [...drawer.querySelectorAll('button:not(:disabled),input:not([hidden]):not(:disabled),select,textarea,summary,a[href]')].filter(element => element.getClientRects().length && !element.hidden);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
store.subscribe(data => {
  settings = data.settings; document.body.dataset.theme = settings.theme;
  if (needsSetup(data)) return;
  if (document.getElementById('setup-form')) { render(); return; }
  document.querySelectorAll('.theme-toolbar [data-theme-choice]').forEach(button => { button.classList.toggle('selected', button.dataset.themeChoice === settings.theme); button.setAttribute('aria-pressed', String(button.dataset.themeChoice === settings.theme)); });
  const sound = document.getElementById('sound-toggle');
  if (sound) { sound.title = settings.sound ? '关闭金币音效' : '开启金币音效'; sound.innerHTML = icon(settings.sound ? 'volume-2' : 'volume-x'); }
  refreshPage(); updateLive(); updateSettingsImpact();
});
render();
if (new URLSearchParams(window.location.search).has('settings')) openDrawer();
function reviewRecord(id) {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return;
  if (document.querySelector('#drawer.open form') && !confirm('打开班次核对会离开当前表单，未保存内容将丢失。继续？')) return;
  const record = store.data.records.find(item => item.id === id);
  if (!record) return toast('记录已变化，请在工作记录中重新选择。');
  if (record.finishedAt === null) recordTools.editor(id, { finishOnly: true });
  else recordTools.detail(id);
}
const reviewQuery = new URLSearchParams(window.location.search).get('review');
if (reviewQuery) {
  reviewRecord(reviewQuery);
  const url = new URL(window.location.href);
  url.searchParams.delete('review');
  window.history.replaceState(null, '', url);
}
async function receiveReviewRequest() {
  try {
    const id = await window.paydropDesktop?.takeReviewRecord?.();
    if (id) reviewRecord(id);
  } catch { toast('无法打开班次核对，请从工作记录中重试。'); }
}
window.paydropDesktop?.onReviewRecord?.(receiveReviewRequest);
void receiveReviewRequest();
window.paydropDesktop?.onUpdateStatus?.(state => { updateEvents += 1; updateState = state; showUpdateState(); });
const initialUpdateEvents = updateEvents;
window.paydropDesktop?.getUpdateState?.().then(state => {
  if (updateEvents !== initialUpdateEvents) return;
  updateState = state;
  showUpdateState();
});
setInterval(updateLive, 1000);
setInterval(async () => {
  if (advancing || !activeRecord(store.data.records)) return;
  advancing = true;
  try { await store.dispatch({ type: 'advance' }); } catch (error) { toast(error.message); }
  finally { advancing = false; }
}, 1000);
if (store.issue) toast(store.issue);
