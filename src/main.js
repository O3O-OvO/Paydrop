import { createIcons, LayoutDashboard, CalendarDays, Settings2, CircleHelp, ChevronDown, ChevronRight, Clock3, Wallet, Timer, Coffee, TrendingUp, ArrowUpRight, Pause, Play, Volume2, VolumeX, RotateCcw, X, Check, Coins, Info, Sparkles, Sun, Moon, Palette, PictureInPicture2, Plus, Trash2 } from 'lucide';
import './style.css';
import './themes.css';
import './settings-opacity.css';
import './breaks.css';
import './update-status.css';
import { updateDigits } from './digit-motion.js';
import { updateCountedAmount } from './amount-counter.js';
import { calculateSchedule, resolveBreaks, scheduleError, secondsOfDay } from './schedule.js';

const icons = { LayoutDashboard, CalendarDays, Settings2, CircleHelp, ChevronDown, ChevronRight, Clock3, Wallet, Timer, Coffee, TrendingUp, ArrowUpRight, Pause, Play, Volume2, VolumeX, RotateCcw, X, Check, Coins, Info, Sparkles, Sun, Moon, Palette, PictureInPicture2, Plus, Trash2 };
const defaults = { dailySalary: 545.45, start: '09:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00' }], paidOvertime: false, sound: false, motion: true, theme: 'hachiware', backgroundOpacity: 8, widgetOpacity: 100 };
const themes = [{ id: 'minimal', label: '极简透明', icon: 'sun' }, { id: 'night', label: '夜晚模式', icon: 'moon' }, { id: 'hachiware', label: '定制小八', icon: 'palette' }];
const key = 'paydrop-settings-v2';
let settings = normalizeSettings(readSettings());
if (!themes.some(theme => theme.id === settings.theme)) settings.theme = defaults.theme;
document.body.dataset.theme = settings.theme;
let paused = false;
let frozenAt = null;
let offset = 0;
let activeView = 'today';
let audioContext;
let updateState = null;
let updateEvents = 0;

function readSettings() {
  try {
    const desktop = window.paydropDesktop?.readSettings();
    if (desktop) return desktop;
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved) return saved;
    const legacy = JSON.parse(localStorage.getItem('paydrop-settings-v1'));
    if (!legacy) return {};
    const { salary, workdays, ...preferences } = legacy;
    return { ...preferences, dailySalary: Number((Number(salary) / Number(workdays)).toFixed(2)) };
  } catch { return {}; }
}
function normalizeSettings(saved) {
  const next = { ...defaults, ...saved, breaks: resolveBreaks(saved, defaults.breaks) };
  return scheduleError(next) ? { ...defaults, breaks: resolveBreaks({}, defaults.breaks) } : next;
}
function storeSettings() {
  if (window.paydropDesktop) window.paydropDesktop.writeSettings(settings);
  else localStorage.setItem(key, JSON.stringify(settings));
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
function chooseTheme(theme) {
  if (!themes.some(item => item.id === theme)) return;
  settings.theme = theme; document.body.dataset.theme = theme; storeSettings();
  document.querySelectorAll('[data-theme-choice]').forEach(button => { button.classList.toggle('selected', button.dataset.themeChoice === theme); button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)); });
}
function pad(n) { return String(n).padStart(2, '0'); }
function money(n, digits = 2) { return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function duration(seconds, withSeconds = true) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return `${pad(h)}:${pad(m)}${withSeconds ? `:${pad(s)}` : ''}`;
}
function now() { return new Date(paused ? frozenAt : Date.now() + offset); }
function calculate(date = now()) { return calculateSchedule(settings, date); }
function timelineSegments(c) {
  const segments = [];
  let position = c.start;
  for (const rest of c.breaks) {
    if (rest.from > position) segments.push({ type: 'work', from: position, to: rest.from });
    segments.push({ type: 'break', from: rest.from, to: rest.to });
    position = rest.to;
  }
  if (position < c.end) segments.push({ type: 'work', from: position, to: c.end });
  return segments.map((item, index) => `<div class="timeline-${item.type} ${index === 0 ? 'timeline-segment-first' : ''} ${index === segments.length - 1 ? 'timeline-segment-last' : ''}" style="left:${(item.from - c.start) / (c.end - c.start) * 100}%;width:${(item.to - item.from) / (c.end - c.start) * 100}%"></div>`).join('');
}
function dateLabel(date) { return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date); }
function timeLabel(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }

function render() {
  const d = now(), c = calculate(d);
  document.querySelector('#app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">${icon('coins')}</div><div><strong>薪动</strong><span>PAYDROP</span></div></div>
        <div class="workspace-label">工作台</div>
        <nav class="nav">
          <button class="nav-item ${activeView === 'today' ? 'active' : ''}" data-view="today">${icon('layout-dashboard')}<span>今日概览</span></button>
          <button class="nav-item ${activeView === 'insights' ? 'active' : ''}" data-view="insights">${icon('calendar-days')}<span>收入测算</span></button>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-note"><span class="note-icon">${icon('sparkles')}</span><strong>每一秒，都算数。</strong><p>认真工作，也认真看见自己的时间。</p></div>
          <button class="nav-item" id="open-settings-side">${icon('settings-2')}<span>薪资与作息设置</span></button>
          <button class="nav-item" id="open-help">${icon('circle-help')}<span>计算说明</span></button>
          <div class="profile"><div class="avatar">我</div><div><strong>我的工作台</strong><span>本地数据 · 仅存于此设备</span></div><span class="profile-dot"></span></div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="breadcrumb">工作台 <span>/</span> ${activeView === 'today' ? '今日概览' : '收入测算'}</div><div class="top-actions"><span class="today-date">${dateLabel(d)}</span><span class="header-divider"></span><button class="icon-button" id="sound-toggle" title="${settings.sound ? '关闭金币音效' : '开启金币音效'}">${icon(settings.sound ? 'volume-2' : 'volume-x')}</button><button class="icon-button" id="open-settings" title="设置">${icon('settings-2')}</button>${widgetButton()}</div></header>
        <nav class="mobile-nav" aria-label="页面导航"><button class="${activeView === 'today' ? 'active' : ''}" data-view="today">今日概览</button><button class="${activeView === 'insights' ? 'active' : ''}" data-view="insights">收入测算</button></nav>
        <div class="page-content">${activeView === 'today' ? todayView(c, d) : insightsView(c)}</div>
      </main>
    </div>
    <div class="overlay" id="overlay" hidden></div>
    <aside class="drawer" id="drawer" aria-label="薪资与作息设置" aria-hidden="true"></aside>
    <div class="toast" id="toast" role="status"></div>
  `;
  document.querySelector('.top-actions .header-divider').insertAdjacentHTML('beforebegin', themeControls('theme-toolbar'));
  refreshIcons();
  bind();
  updateLive();
}
function todayView(c, d) {
  return `<div class="page-heading"><div><div class="eyebrow"><span class="live-dot"></span> 实时计薪 · ${c.state}</div><h1>今天的每一秒，都有回响<span class="heading-spark">✳</span></h1><p>把时间变成看得见的收获。</p></div><button class="outline-button" id="quick-settings">${icon('settings-2')} 调整工作时间</button></div>
    <div class="dashboard-grid">
      <div class="primary-column">
        <section class="earnings-panel"><div class="panel-top"><span class="panel-kicker">今日已赚取</span><span class="earning-status"><span></span>${c.state}</span></div>
          <div class="earning-main"><div class="currency">¥</div><div class="earnings-number" id="earned-number">${money(c.earned, 4)}</div><div class="coin-stage" id="coin-stage"><img class="dashboard-mascot" src="./hachiware-face.png" alt="小八角色头像" /></div></div>
          <div class="earning-footer"><span>${icon('trending-up')} <span id="earning-caption">${c.state === '工作中' ? `正在以 ¥${money(c.rate, 4)} / 秒增长` : c.state === '休息中' ? '无薪休息中，收入暂缓累计' : c.state === '未开工' ? '尚未开工，等待今天的第一笔收入' : settings.paidOvertime ? '有薪加班中，收入继续累计' : '已下班，今日收入已结算'}</span></span><span>今日目标 ¥${money(c.daily)}</span></div>
          <div class="earning-track"><div id="earning-track-fill" style="width:${Math.min(100, c.earned / c.daily * 100)}%"></div></div>
          <div class="panel-grain"></div>
        </section>
        <div class="metric-grid">
          <section class="metric-card countdown"><div class="metric-icon orange">${icon('timer')}</div><div class="metric-copy"><span>距离下班</span><strong id="remaining">${duration(c.remaining)}</strong><small id="remaining-caption">${c.remaining ? `今天 ${settings.end} 下班` : '今天已下班，辛苦了'}</small></div><div class="tiny-clock"><span class="clock-hand"></span></div></section>
          <section class="metric-card"><div class="metric-icon green">${icon('clock-3')}</div><div class="metric-copy"><span>已工作时长</span><strong id="worked">${duration(c.worked)}</strong><small>含加班，不含休息</small></div></section>
          <section class="metric-card"><div class="metric-icon red">${icon('coffee')}</div><div class="metric-copy"><span>无偿打工时长</span><strong id="unpaid">${duration(c.unpaid)}</strong><small>下班后未计薪加班</small></div></section>
        </div>
        <section class="timeline-section"><div class="section-title"><div><h2>今天的时间轴</h2><p>工作、休息和下班，一目了然</p></div><span class="section-date">${dateLabel(d)}</span></div><div class="timeline-line">${timelineSegments(c)}<div class="timeline-now" id="timeline-now" style="left:${c.progress}%"><span></span></div></div><div class="timeline-labels"><div><b>${settings.start}</b><span>上班</span></div><div class="timeline-break-label"><b>${c.breaks.length ? c.breaks.map(rest => `${rest.start}–${rest.end}`).join(' · ') : '无休息时段'}</b><span>${c.breaks.length} 段无薪休息 · 共 ${Math.round(c.breakTotal / 60)} 分钟</span></div><div><b>${settings.end}</b><span>下班</span></div></div><div class="legend"><span><i class="legend-dot working"></i> 工作时间</span><span><i class="legend-dot resting"></i> 无薪休息</span><span><i class="legend-dot present"></i> 当前时间</span></div></section>
      </div>
      <div class="side-column">
        <section class="clock-panel"><div class="clock-top"><span>此刻时间</span>${icon('clock-3')}</div><strong id="current-time">${timeLabel(d)}</strong><span class="clock-date">${dateLabel(d)}</span><div class="clock-decoration"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div></section>
        <section class="rate-panel"><div class="section-title compact"><div><h2>我的薪资速率</h2><p>按当前薪资与作息计算</p></div>${icon('wallet')}</div><div class="rate-row"><div class="rate-symbol">¥</div><strong id="rate-value">${money(c.rate, 4)}</strong><span>/ 秒</span></div><div class="rate-divider"></div><div class="rate-detail"><span>每分钟</span><strong>¥${money(c.rate * 60)}</strong></div><div class="rate-detail"><span>每小时</span><strong>¥${money(c.rate * 3600)}</strong></div><div class="rate-detail"><span>每工作日</span><strong>¥${money(c.daily)}</strong></div><button class="text-link" id="rate-settings">查看计算依据 ${icon('arrow-up-right')}</button></section>
        <section class="daily-panel"><div class="section-title compact"><div><h2>今日状态</h2><p>让努力有迹可循</p></div></div><div class="daily-item"><span class="daily-marker start">${icon('play')}</span><div><strong>开始工作</strong><small>${settings.start} · 今日起点</small></div><span class="item-check">${icon('check')}</span></div>${c.breaks.map((rest, index) => `<div class="daily-item"><span class="daily-marker break">${icon('coffee')}</span><div><strong>无薪休息 ${index + 1}</strong><small>${rest.start}–${rest.end}</small></div><span class="item-time">${Math.round((rest.to - rest.from) / 60)} 分钟</span></div>`).join('')}<div class="daily-item"><span class="daily-marker finish">${icon('sparkles')}</span><div><strong>结束工作</strong><small>${settings.end} · 今日目标</small></div><span class="item-time">${c.current >= c.end ? '已完成' : '待完成'}</span></div></section>
      </div>
    </div>
    <div class="bottom-bar"><span>${icon('info')} 金额仅供参考，实际薪资以劳动合同和发薪记录为准。</span><div><button id="pause-toggle" class="subtle-button">${icon(paused ? 'play' : 'pause')} ${paused ? '继续计时' : '暂停展示'}</button><span class="footer-separator"></span><button id="reset-clock" class="subtle-button" title="回到真实时间">${icon('rotate-ccw')} 回到现在</button></div></div>`;
}
function insightsView(c) {
  const weekly = c.daily * 5;
  return `<div class="page-heading"><div><div class="eyebrow"><span class="live-dot"></span> 收入测算</div><h1>看清每一段时间的价值<span class="heading-spark">✳</span></h1><p>基于你的日薪和日常作息，换算出薪资速率。</p></div><button class="outline-button" id="quick-settings">${icon('settings-2')} 调整计算参数</button></div><div class="insights-layout"><section class="insight-hero"><span>当前秒薪</span><div>¥ <strong>${money(c.rate, 4)}</strong><small>/ 秒</small></div><p>按日薪 ¥${money(c.daily)}、每日 ${duration(c.scheduled, false)} 有薪时间计算</p><div class="insight-columns"><div><span>每分钟</span><strong>¥${money(c.rate * 60)}</strong></div><div><span>每小时</span><strong>¥${money(c.rate * 3600)}</strong></div><div><span>每工作日</span><strong>¥${money(c.daily)}</strong></div></div></section><div class="insight-right"><section class="insight-card"><div class="metric-icon green">${icon('wallet')}</div><span>日薪</span><strong>¥${money(c.daily)}</strong><p>以实际合同为准</p></section><section class="insight-card"><div class="metric-icon orange">${icon('calendar-days')}</div><span>五个工作日预估</span><strong>¥${money(weekly)}</strong><p>按标准工作时长计算</p></section></div></div><section class="formula-section"><h2>计算依据</h2><div class="formula-line"><span>日薪</span><b>÷</b><span>每日有薪秒数</span><b>=</b><strong>实时秒薪</strong></div><p>每日有薪时间为 ${settings.start}–${settings.end}${c.breaks.length ? `，扣除 ${c.breaks.map(rest => `${rest.start}–${rest.end}`).join('、')} 共 ${Math.round(c.breakTotal / 60)} 分钟无薪休息` : '，没有设置无薪休息'}。${settings.paidOvertime ? '下班后的加班计入收入。' : '下班后的时间默认按无薪加班统计，不计入收入。'}</p></section>`;
}
function updateLive() {
  const c = calculate(), d = now();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const motion = settings.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  updateCountedAmount(document.getElementById('earned-number'), c.earned, motion && !paused, spawnCoin);
  updateDigits(document.getElementById('remaining'), duration(c.remaining), motion, 'down');
  updateDigits(document.getElementById('worked'), duration(c.worked), motion);
  updateDigits(document.getElementById('unpaid'), duration(c.unpaid), motion);
  updateDigits(document.getElementById('current-time'), timeLabel(d), motion);
  set('earning-caption', c.state === '工作中' ? `正在以 ¥${money(c.rate, 4)} / 秒增长` : c.state === '休息中' ? '无薪休息中，收入暂缓累计' : c.state === '未开工' ? '尚未开工，等待今天的第一笔收入' : settings.paidOvertime ? '有薪加班中，收入继续累计' : '已下班，今日收入已结算');
  set('remaining-caption', c.remaining ? `今天 ${settings.end} 下班` : '今天已下班，辛苦了');
  const track = document.getElementById('earning-track-fill'); if (track) track.style.width = `${Math.min(100, c.earned / c.daily * 100)}%`;
  const marker = document.getElementById('timeline-now'); if (marker) marker.style.left = `${c.progress}%`;
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
    error: '检查失败，请稍后重试',
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
    <button type="button" class="save-button" id="install-update" hidden>重启更新</button></div>`;
}
function openDrawer(kind = 'settings') {
  const drawer = document.getElementById('drawer'), overlay = document.getElementById('overlay');
  drawer.innerHTML = kind === 'help' ? `<div class="drawer-header"><div><span>帮助</span><h2>计算说明</h2></div><button class="icon-button close-drawer" aria-label="关闭">${icon('x')}</button></div><div class="drawer-body help-body"><h3>秒薪怎么算？</h3><p>日薪 ÷ 每日有薪秒数。每日有薪时间会扣除设置的无薪休息，今日收入每秒更新一次。</p><h3>无偿打工时长是什么？</h3><p>下班后未开启加班计薪的工作时间。无薪休息不算工作，因此不计入无偿打工时长。</p><h3>暂停展示会怎样？</h3><p>界面数字暂时停留在当前时刻；继续后会追上真实时间，不会丢失收入。所有数据仅保存在这个浏览器中。</p><div class="help-note">这是一款可视化记薪工具，不能替代考勤和工资条。</div></div>` : settingsForm();
  drawer.querySelector('.close-drawer').insertAdjacentHTML('beforebegin', widgetButton());
  overlay.hidden = false; requestAnimationFrame(() => { overlay.classList.add('visible'); drawer.classList.add('open'); }); drawer.setAttribute('aria-hidden', 'false'); refreshIcons();
  drawer.querySelector('[data-return-widget]').onclick = returnToWidget;
  if (kind === 'settings') {
    drawer.querySelector('.drawer-body').insertAdjacentHTML('afterbegin', `<div class="form-section-title">外观主题</div>${themeControls('theme-picker')}${opacityControls()}`);
    refreshIcons();
    drawer.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => chooseTheme(button.dataset.themeChoice));
    drawer.querySelectorAll('.opacity-control input').forEach(input => {
      input.oninput = () => { input.closest('.opacity-control').querySelector('output').value = `${input.value}%`; };
    });
    const list = drawer.querySelector('#break-list');
    drawer.querySelector('#add-break').onclick = () => {
      list.insertAdjacentHTML('beforeend', breakRow({ start: '', end: '' }, list.children.length));
      refreshIcons();
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
    };
    const check = drawer.querySelector('#check-update');
    if (check) check.onclick = () => window.paydropDesktop.checkForUpdates().catch(() => toast('检查更新失败'));
    const install = drawer.querySelector('#install-update');
    if (install) install.onclick = () => window.paydropDesktop.installUpdate();
    showUpdateState();
  }
  drawer.querySelector('.close-drawer').onclick = closeDrawer;
  if (kind === 'settings') { drawer.querySelector('#settings-form').onsubmit = saveSettings; drawer.querySelector('#reset-defaults').onclick = () => { settings = { ...defaults }; document.body.dataset.theme = settings.theme; storeSettings(); closeDrawer(); render(); toast('已恢复默认设置'); }; }
}
function breakRow(rest, index) {
  return `<div class="break-row">
    <span class="break-index" aria-hidden="true">${index + 1}</span>
    <label class="field">开始<input name="breakStart" type="time" value="${rest.start}" required aria-label="第 ${index + 1} 段休息开始"></label>
    <label class="field">结束<input name="breakEnd" type="time" value="${rest.end}" required aria-label="第 ${index + 1} 段休息结束"></label>
    <button type="button" class="icon-button remove-break" data-remove-break title="删除休息时段" aria-label="删除第 ${index + 1} 段休息">${icon('trash-2')}</button>
  </div>`;
}
function settingsForm() {
  return `<div class="drawer-header"><div><span>偏好设置</span><h2>薪资与作息</h2></div><button class="icon-button close-drawer" aria-label="关闭">${icon('x')}</button></div>
  <form id="settings-form"><div class="drawer-body">
    <div class="form-section-title">薪资信息</div>
    <div class="field-grid"><label class="field">日薪（元）<input name="dailySalary" type="number" min="0.01" step="0.01" value="${settings.dailySalary}" required></label></div>
    <div class="form-section-title">每日作息</div>
    <div class="field-grid"><label class="field">上班时间<input name="start" type="time" value="${settings.start}" required></label><label class="field">下班时间<input name="end" type="time" value="${settings.end}" required></label></div>
    <div class="break-heading"><div class="form-section-title">休息时段</div><button type="button" class="add-break" id="add-break">${icon('plus')} 添加休息</button></div>
    <div id="break-list" class="break-list">${settings.breaks.map(breakRow).join('')}</div>
    <p class="field-hint">可添加多段无薪休息，也可全部删除；时段不能重叠，暂不支持跨午夜班次。</p>
    <div class="form-section-title">计薪偏好</div>
    <label class="switch-row"><div><strong>加班计薪</strong><span>下班后继续按标准秒薪累计</span></div><input name="paidOvertime" type="checkbox" ${settings.paidOvertime ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>金币音效</strong><span>金币掉落时播放轻提示音</span></div><input name="sound" type="checkbox" ${settings.sound ? 'checked' : ''}><i></i></label>
    <label class="switch-row"><div><strong>动态效果</strong><span>显示金币掉落与数字过渡</span></div><input name="motion" type="checkbox" ${settings.motion ? 'checked' : ''}><i></i></label>
    ${updateSettings()}
    <div class="form-error" id="form-error" role="alert"></div>
  </div><div class="drawer-footer"><button type="button" class="subtle-button" id="reset-defaults">恢复默认</button><button type="submit" class="save-button">${icon('check')} 保存设置</button></div></form>`;
}
function saveSettings(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const ends = form.getAll('breakEnd');
  const breaks = form.getAll('breakStart').map((start, index) => ({ start, end: ends[index] }))
    .sort((a, b) => secondsOfDay(a.start) - secondsOfDay(b.start));
  const next = { dailySalary: Number(form.get('dailySalary')), start: form.get('start'), end: form.get('end'), breaks, paidOvertime: form.has('paidOvertime'), sound: form.has('sound'), motion: form.has('motion'), theme: settings.theme, backgroundOpacity: Number(form.get('backgroundOpacity')), widgetOpacity: Number(form.get('widgetOpacity')) };
  const error = scheduleError(next);
  if (error) { document.getElementById('form-error').textContent = error; return; }
  settings = next; storeSettings(); closeDrawer(); render(); toast('设置已保存，今日收入已重新计算');
}
function closeDrawer() { const drawer = document.getElementById('drawer'), overlay = document.getElementById('overlay'); drawer.classList.remove('open'); overlay.classList.remove('visible'); drawer.setAttribute('aria-hidden', 'true'); setTimeout(() => { overlay.hidden = true; }, 260); }
function bind() {
  document.querySelector('.topbar [data-return-widget]').onclick = returnToWidget;
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => chooseTheme(button.dataset.themeChoice));
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { activeView = button.dataset.view; render(); });
  ['open-settings', 'open-settings-side', 'quick-settings', 'rate-settings'].forEach(id => { const el = document.getElementById(id); if (el) el.onclick = () => openDrawer(); });
  document.getElementById('open-help').onclick = () => openDrawer('help');
  document.getElementById('overlay').onclick = closeDrawer;
  document.getElementById('sound-toggle').onclick = () => { settings.sound = !settings.sound; storeSettings(); render(); toast(settings.sound ? '金币音效已开启' : '金币音效已关闭'); };
  const pauseButton = document.getElementById('pause-toggle'); if (pauseButton) pauseButton.onclick = () => { if (paused) { paused = false; frozenAt = null; } else { frozenAt = Date.now() + offset; paused = true; } render(); toast(paused ? '展示已暂停，实际时间仍在流逝' : '已继续实时展示'); };
  const reset = document.getElementById('reset-clock'); if (reset) reset.onclick = () => { offset = 0; paused = false; frozenAt = null; render(); toast('已回到当前时间'); };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
window.addEventListener('storage', event => { if (event.key === key) { settings = normalizeSettings(readSettings()); document.body.dataset.theme = themes.some(theme => theme.id === settings.theme) ? settings.theme : defaults.theme; render(); } });
render();
if (new URLSearchParams(window.location.search).has('settings')) openDrawer();
window.paydropDesktop?.onUpdateStatus?.(state => { updateEvents += 1; updateState = state; showUpdateState(); });
const initialUpdateEvents = updateEvents;
window.paydropDesktop?.getUpdateState?.().then(state => {
  if (updateEvents !== initialUpdateEvents) return;
  updateState = state;
  showUpdateState();
});
setInterval(updateLive, 1000);
setInterval(() => { const d = now(); if (d.getSeconds() === 0) { const state = calculate(d).state; const shown = document.querySelector('.earning-status'); if (shown && shown.textContent !== state) render(); } }, 1000);
