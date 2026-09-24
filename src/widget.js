import { createIcons, Settings2, Minus, X, Coins, Clock3, Timer, Coffee, TrendingUp, Palette, Pause, Play, RefreshCw } from 'lucide';
import './widget.css';
import './widget-themes.css';
import './widget-opacity.css';
import './coin-pile.css';
import './widget-update.css';
import { updateDigits } from './digit-motion.js';
import { updateCountedAmount } from './amount-counter.js';
import { calculateSchedule, resolveBreaks, scheduleError } from './schedule.js';

const icons = { Settings2, Minus, X, Coins, Clock3, Timer, Coffee, TrendingUp, Palette, Pause, Play, RefreshCw };
const defaults = { dailySalary: 545.45, start: '09:00', end: '18:00', breaks: [{ start: '12:00', end: '13:00' }], paidOvertime: false, motion: true, theme: 'hachiware', backgroundOpacity: 8, widgetOpacity: 100 };
const themes = ['minimal', 'night', 'hachiware'];
let settings = loadSettings();
let previousTier = null;
let paused = false;
let frozenAt = null;
let updateState = null;
let updateEvents = 0;

function loadSettings() {
  try {
    const desktop = window.paydropDesktop?.readSettings();
    if (desktop) return normalizeSettings(desktop);
    const saved = JSON.parse(localStorage.getItem('paydrop-settings-v2'));
    if (saved) return normalizeSettings(saved);
    const legacy = JSON.parse(localStorage.getItem('paydrop-settings-v1'));
    if (legacy) return normalizeSettings({ ...legacy, dailySalary: Number((legacy.salary / legacy.workdays).toFixed(2)) });
  } catch {}
  return normalizeSettings({});
}
function normalizeSettings(saved) {
  const next = { ...defaults, ...saved, breaks: resolveBreaks(saved, defaults.breaks) };
  return scheduleError(next) ? { ...defaults } : next;
}
function pad(value) { return String(value).padStart(2, '0'); }
function duration(value) { const total = Math.max(0, Math.floor(value)); return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total % 3600 / 60))}:${pad(total % 60)}`; }
function money(value, digits = 4) { return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function data(now = new Date()) { return calculateSchedule(settings, now); }
function coinTier(earned) {
  const progress = Math.max(0, earned / Number(settings.dailySalary));
  return progress >= 1 ? 5 : Math.min(4, Math.floor(progress * 5));
}
function icon(name) { return `<i data-lucide="${name}"></i>`; }
function opacity(value, fallback, minimum = 0) {
  const number = Number(value);
  return (Number.isFinite(number) ? Math.max(minimum, Math.min(100, number)) : fallback) / 100;
}
function applyTheme() {
  document.body.dataset.theme = themes.includes(settings.theme) ? settings.theme : 'hachiware';
  document.body.style.setProperty('--widget-background-opacity', opacity(settings.backgroundOpacity, defaults.backgroundOpacity));
  document.body.style.setProperty('--widget-opacity', opacity(settings.widgetOpacity, defaults.widgetOpacity, 20));
  const button = document.getElementById('widget-theme');
  if (button) button.title = `切换主题 · 当前${({ minimal: '极简透明', night: '夜晚模式', hachiware: '定制小八' })[document.body.dataset.theme]}`;
}
function cycleTheme() {
  settings.theme = themes[(themes.indexOf(document.body.dataset.theme) + 1) % themes.length];
  if (window.paydropDesktop) window.paydropDesktop.writeSettings(settings);
  else localStorage.setItem('paydrop-settings-v2', JSON.stringify(settings));
  applyTheme();
}
function togglePause() {
  paused = !paused;
  frozenAt = paused ? new Date() : null;
  previousTier = null;
  render();
}
function render() {
  applyTheme();
  document.querySelector('#widget').innerHTML = `<section class="widget-card">
    <header class="widget-header"><div class="widget-brand"><span class="widget-brand-icon">${icon('coins')}<img src="./hachiware-face.png" alt="" /></span><strong>薪动</strong><span>PAYDROP</span></div><div class="window-actions"><button id="widget-update" title="重启安装更新" aria-label="重启安装更新" hidden>${icon('refresh-cw')}</button><button id="widget-theme" title="切换主题" aria-label="切换主题">${icon('palette')}</button><button id="widget-pause" title="${paused ? '继续实时展示' : '暂停展示'}" aria-label="${paused ? '继续实时展示' : '暂停展示'}" aria-pressed="${paused}">${icon(paused ? 'play' : 'pause')}</button><button id="widget-settings" title="打开设置与详情" aria-label="打开设置与详情">${icon('settings-2')}</button><button id="widget-minimize" title="最小化" aria-label="最小化">${icon('minus')}</button><button id="widget-close" title="退出挂件" aria-label="退出挂件">${icon('x')}</button></div></header>
    <div class="widget-label"><span class="status-dot"></span><span id="widget-state">工作中</span><span class="widget-label-right">今日已赚取</span></div>
    <div class="widget-amount"><span>¥</span><strong id="widget-earned">0.0000</strong><div class="coin-display" id="coin-display" role="img" aria-label="今日金币积累"><div class="coin-pile" id="coin-pile"><span class="coin-piece coin-one"></span><span class="coin-piece coin-two"></span><span class="coin-piece coin-three"></span><span class="coin-piece coin-four"></span><span class="coin-piece coin-five"></span><span class="coin-piece coin-six"></span></div><div id="widget-coins" class="widget-coins"></div></div></div>
    <div class="widget-rate">${icon('trending-up')}<span id="widget-rate">¥0.0000 / 秒</span><span id="widget-rate-caption" class="rate-caption">实时计薪</span></div>
    <div class="widget-progress"><span id="widget-progress-fill"></span></div>
    <div class="widget-metrics"><div>${icon('timer')}<span>距离下班</span><strong id="widget-remaining">00:00:00</strong></div><div>${icon('clock-3')}<span>已工作</span><strong id="widget-worked">00:00:00</strong></div><div>${icon('coffee')}<span>无偿时长</span><strong id="widget-unpaid">00:00:00</strong></div></div>
  </section>`;
  createIcons({ icons });
  applyTheme();
  document.querySelector('#widget-theme').onclick = cycleTheme;
  document.querySelector('#widget-pause').onclick = togglePause;
  document.querySelector('#widget-settings').onclick = () => {
    if (window.paydropDesktop) window.paydropDesktop.openDashboard();
    else window.location.href = new URL('./index.html?settings=1', window.location.href).href;
  };
  document.querySelector('#widget-minimize').onclick = () => window.paydropDesktop?.minimize();
  document.querySelector('#widget-close').onclick = () => window.paydropDesktop?.close();
  document.querySelector('#widget-update').onclick = () => window.paydropDesktop?.installUpdate();
  showUpdateState();
  tick();
}
function showUpdateState() {
  const button = document.getElementById('widget-update');
  if (!button) return;
  button.hidden = updateState?.phase !== 'ready';
  if (!button.hidden) button.title = `版本 ${updateState.availableVersion} 已就绪，重启安装更新`;
}
function tick(allowCoin = true) {
  const result = data(paused ? frozenAt : new Date());
  const update = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  update('widget-state', paused ? '已暂停' : result.state);
  const earnedText = money(result.earned);
  const motion = !paused && settings.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  updateCountedAmount(document.getElementById('widget-earned'), result.earned, motion, allowCoin ? spawnWidgetCoin : undefined);
  document.getElementById('widget-earned').style.fontSize = `${earnedText.length > 11 ? 27 : earnedText.length > 9 ? 32 : 39}px`;
  update('widget-rate', `¥${money(result.rate)} / 秒`);
  update('widget-rate-caption', paused ? '暂停展示' : '实时计薪');
  updateDigits(document.getElementById('widget-remaining'), duration(result.remaining), motion, 'down');
  updateDigits(document.getElementById('widget-worked'), duration(result.worked), motion);
  updateDigits(document.getElementById('widget-unpaid'), duration(result.unpaid), motion);
  document.getElementById('widget-progress-fill').style.width = `${result.progress}%`;
  document.querySelector('.widget-card').dataset.state = paused ? '已暂停' : result.state;
  const tier = coinTier(result.earned);
  const pile = document.getElementById('coin-display');
  pile.dataset.tier = tier;
  pile.setAttribute('aria-label', `今日金币积累 ${Math.min(100, Math.floor(result.earned / Number(settings.dailySalary) * 100))}%`);
  if (previousTier !== null && tier > previousTier && motion) {
    pile.classList.remove('tier-up'); void pile.offsetWidth; pile.classList.add('tier-up');
  }
  previousTier = tier;
}
function spawnWidgetCoin() {
  const coin = document.createElement('span');
  coin.className = 'widget-falling-coin';
  document.getElementById('widget-coins').appendChild(coin);
  coin.addEventListener('animationend', () => coin.remove());
}
window.paydropDesktop?.onSettingsChanged(() => { settings = loadSettings(); applyTheme(); previousTier = null; tick(false); });
window.addEventListener('storage', (event) => { if (event.key === 'paydrop-settings-v2') { settings = loadSettings(); applyTheme(); previousTier = null; tick(false); } });
render();
window.paydropDesktop?.onUpdateStatus?.(state => { updateEvents += 1; updateState = state; showUpdateState(); });
const initialUpdateEvents = updateEvents;
window.paydropDesktop?.getUpdateState?.().then(state => {
  if (updateEvents !== initialUpdateEvents) return;
  updateState = state;
  showUpdateState();
});
setInterval(tick, 1000);
