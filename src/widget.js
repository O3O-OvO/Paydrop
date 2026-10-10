import { createIcons, Settings2, Minus, X, Coins, Clock3, Timer, Coffee, TrendingUp, Palette, Pause, Play, RefreshCw, ClipboardCheck, PawPrint, Hand, Cookie, Accessibility, Music2, ExternalLink, Scaling, MoveDiagonal, RotateCcw, CircleAlert, Eye, Moon } from 'lucide';
import './widget.css';
import './widget-themes.css';
import './widget-opacity.css';
import './coin-pile.css';
import './widget-update.css';
import './widget-session.css';
import './widget-companion.css';
import './widget-sizing.css';
import './widget-density.css';
import { updateDigits } from './digit-motion.js';
import { updateCountedAmount } from './amount-counter.js';
import { store } from './client-store.js';
import { defaults } from './settings.js';
import { activeRecord, currentCalculation } from './work-log.js';
import { workPresentation, overtimeReminder } from './work-status.js';
import { companionMarkup, mountWidgetCompanion } from './widget-companion.js';
import { clampWidgetScale, scaleAfterDrag, widgetHeight, MIN_WIDGET_SCALE, MAX_WIDGET_SCALE } from './widget-sizing.js';

const icons = { Settings2, Minus, X, Coins, Clock3, Timer, Coffee, TrendingUp, Palette, Pause, Play, RefreshCw, ClipboardCheck, PawPrint, Hand, Cookie, Accessibility, Music2, ExternalLink, Scaling, MoveDiagonal, RotateCcw, CircleAlert, Eye, Moon };
const themes = ['minimal', 'night', 'hachiware'];
let settings = (await store.init()).settings;
let previousTier = null;
let paused = false;
let frozenAt = null;
let updateState = null;
let updateEvents = 0;
let advancing = false;
let companion = null;
let scaleDraft = null, scaleTimer = null, scaleSaving = false, sizeDrag = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

async function attempt(task) {
  try { await task(); } catch (error) {
    const toast = document.getElementById('widget-toast');
    toast.textContent = error.message || '操作失败';
    toast.hidden = false;
    clearTimeout(attempt.timer); attempt.timer = setTimeout(() => { toast.hidden = true; }, 5000);
  }
}
function pad(value) { return String(value).padStart(2, '0'); }
function duration(value) { const total = Math.max(0, Math.floor(value)); return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total % 3600 / 60))}:${pad(total % 60)}`; }
function money(value, digits = 4) { return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function data(now = new Date()) { return currentCalculation(settings, store.data.records, now); }
function coinTier(earned, daily) {
  const progress = Math.max(0, earned / daily);
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
  document.body.dataset.density = settings.widgetDensity || 'standard';
  document.documentElement.style.setProperty('--widget-height', `${widgetHeight(settings)}px`);
  const preset = document.getElementById('widget-layout');
  if (preset) preset.value = settings.widgetPetEnabled ? 'companion' : settings.widgetDensity === 'compact' ? 'compact' : 'standard';
  applyWidgetScale();
  const petButton = document.getElementById('widget-pet');
  if (petButton) {
    petButton.setAttribute('aria-pressed', String(settings.widgetPetEnabled));
    petButton.title = settings.widgetPetEnabled ? '收起挂件小八' : '显示挂件小八';
  }
  const button = document.getElementById('widget-theme');
  if (button) button.title = `切换主题 · 当前${({ minimal: '极简透明', night: '夜晚模式', hachiware: '定制小八' })[document.body.dataset.theme]}`;
}
function applyWidgetScale() {
  const value = scaleDraft ?? settings.widgetScale;
  document.documentElement.style.setProperty('--widget-visual-scale', window.paydropDesktop ? 1 : value / 100);
  for (const id of ['widget-size-value', 'widget-size-output']) {
    const element = document.getElementById(id);
    if (element) element.textContent = `${value}%`;
  }
  const range = document.getElementById('widget-size-range');
  if (range) range.value = value;
  document.getElementById('widget-resize')?.setAttribute('aria-valuenow', String(value));
}
function requestWidgetScale(value, delay = 80) {
  scaleDraft = clampWidgetScale(value);
  applyWidgetScale();
  if (delay === 0) { clearTimeout(scaleTimer); scaleTimer = null; }
  if (scaleTimer === null) {
    scaleTimer = setTimeout(() => { scaleTimer = null; void saveWidgetScale(); }, delay);
  }
}
async function saveWidgetScale() {
  if (scaleSaving || scaleDraft === null) return;
  const value = scaleDraft;
  scaleSaving = true;
  try {
    if (value !== settings.widgetScale) await store.dispatch({ type: 'settings', patch: { widgetScale: value } });
    if (scaleDraft === value) scaleDraft = null;
  } catch (error) {
    scaleDraft = null;
    await attempt(() => { throw error; });
  } finally {
    scaleSaving = false;
    applyWidgetScale();
    if (scaleDraft !== null) void saveWidgetScale();
  }
}
function toggleSizePanel(open, restoreFocus = false) {
  const panel = document.getElementById('widget-size-panel');
  panel.hidden = !open;
  document.getElementById('widget-size-toggle').setAttribute('aria-expanded', String(open));
  if (open) document.getElementById('widget-size-range').focus();
  else if (restoreFocus) document.getElementById('widget-size-toggle').focus();
}
function bindWidgetSizing() {
  document.getElementById('widget-size-toggle').onclick = () => toggleSizePanel(document.getElementById('widget-size-panel').hidden);
  document.getElementById('widget-size-close').onclick = () => toggleSizePanel(false, true);
  document.getElementById('widget-size-reset').onclick = () => requestWidgetScale(100, 0);
  const range = document.getElementById('widget-size-range');
  range.oninput = () => requestWidgetScale(Number(range.value));
  range.onchange = () => requestWidgetScale(Number(range.value), 0);
  const handle = document.getElementById('widget-resize');
  handle.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0) return;
    toggleSizePanel(false);
    sizeDrag = { id: event.pointerId, x: event.screenX, y: event.screenY,
      scale: scaleDraft ?? settings.widgetScale, height: widgetHeight(settings) };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  handle.onpointermove = event => {
    if (!sizeDrag || sizeDrag.id !== event.pointerId) return;
    const dx = event.screenX - sizeDrag.x, dy = event.screenY - sizeDrag.y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    requestWidgetScale(scaleAfterDrag(sizeDrag.scale, dx, dy, sizeDrag.height));
  };
  const finishDrag = event => {
    if (!sizeDrag || sizeDrag.id !== event.pointerId) return;
    const originalScale = sizeDrag.scale;
    sizeDrag = null;
    if (event.type === 'pointercancel') requestWidgetScale(originalScale, 0);
    else { clearTimeout(scaleTimer); scaleTimer = null; void saveWidgetScale(); }
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.onpointerup = finishDrag;
  handle.onpointercancel = finishDrag;
  handle.onlostpointercapture = finishDrag;
  handle.onkeydown = event => {
    const value = scaleDraft ?? settings.widgetScale;
    const next = { ArrowRight: value + 5, ArrowUp: value + 5, ArrowLeft: value - 5,
      ArrowDown: value - 5, Home: MIN_WIDGET_SCALE, End: MAX_WIDGET_SCALE }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    requestWidgetScale(next, 0);
  };
}
async function cycleTheme() {
  const theme = themes[(themes.indexOf(document.body.dataset.theme) + 1) % themes.length];
  await store.dispatch({ type: 'settings', patch: { theme } });
  applyTheme();
}
function togglePause() {
  paused = !paused;
  frozenAt = paused ? new Date() : null;
  const button = document.getElementById('widget-pause');
  button.title = paused ? '恢复实时数字' : '冻结数字（不暂停打卡或计薪）';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(paused));
  button.innerHTML = `${icon(paused ? 'play' : 'pause')}<span>${paused ? '恢复实时数字' : '冻结数字'}</span>`;
  document.getElementById('widget-display-menu').open = false;
  document.querySelector('#widget-display-menu summary').focus();
  createIcons({ icons });
  tick(false);
}
function render() {
  companion?.destroy();
  applyTheme();
  document.querySelector('#widget').innerHTML = `<section class="widget-card">
    <header class="widget-header"><div class="widget-brand"><span class="widget-brand-icon">${icon('coins')}<img src="./hachiware-face.png" alt="" /></span><strong>薪动</strong><span>PAYDROP</span></div><div class="window-actions"><button id="widget-update" title="重启安装更新" aria-label="重启安装更新" hidden>${icon('refresh-cw')}</button><button id="widget-theme" title="切换主题" aria-label="切换主题">${icon('palette')}</button><details class="widget-display-menu" id="widget-display-menu"><summary title="画面显示" aria-label="画面显示">${icon('eye')}</summary><div class="widget-display-options"><button id="widget-pause" title="冻结数字（不暂停打卡或计薪）" aria-label="冻结数字（不暂停打卡或计薪）" aria-pressed="${paused}">${icon(paused ? 'play' : 'pause')}<span>${paused ? '恢复实时数字' : '冻结数字'}</span></button><span>打卡与计薪不受影响</span></div></details><button id="widget-settings" title="打开设置与详情" aria-label="打开设置与详情">${icon('settings-2')}</button><button id="widget-minimize" title="最小化" aria-label="最小化">${icon('minus')}</button><button id="widget-close" title="退出挂件" aria-label="退出挂件">${icon('x')}</button></div></header>
    <div class="widget-label"><span class="status-dot"></span><span id="widget-state">工作中</span><button type="button" id="widget-review" class="widget-review" aria-label="核对长时加班记录" hidden>${icon('circle-alert')}<span>核对加班</span></button><span class="widget-label-right">今日已赚取</span></div>
    <div class="widget-amount"><span>¥</span><strong id="widget-earned">0.0000</strong><div class="coin-display" id="coin-display" role="img" aria-label="今日金币积累"><div class="coin-pile" id="coin-pile"><span class="coin-piece coin-one"></span><span class="coin-piece coin-two"></span><span class="coin-piece coin-three"></span><span class="coin-piece coin-four"></span><span class="coin-piece coin-five"></span><span class="coin-piece coin-six"></span></div><div id="widget-coins" class="widget-coins"></div></div></div>
    <div class="widget-rate">${icon('trending-up')}<span id="widget-rate">¥0.0000 / 秒</span><span id="widget-rate-caption" class="rate-caption">实时计薪</span><button type="button" id="widget-unfreeze" hidden title="数字已冻结，打卡状态未改变；点击恢复实时">数字已冻结 ${icon('play')}</button></div>
    <div class="widget-progress"><span id="widget-progress-fill"></span></div>
    <div class="widget-metrics"><div>${icon('timer')}<span id="widget-time-label">距计划下班</span><strong id="widget-remaining">00:00:00</strong></div><div>${icon('clock-3')}<span>已工作</span><strong id="widget-worked">00:00:00</strong></div><div>${icon('coffee')}<span>无偿时长</span><strong id="widget-unpaid">00:00:00</strong></div></div>
    ${companionMarkup()}
    <footer id="widget-session" class="widget-session"></footer>
    <button type="button" class="widget-size-toggle" id="widget-size-toggle" title="调整挂件大小" aria-label="调整挂件大小" aria-expanded="false" aria-controls="widget-size-panel">${icon('scaling')}<span id="widget-size-value">${settings.widgetScale}%</span></button>
    <div class="widget-size-panel" id="widget-size-panel" role="group" aria-label="挂件大小设置" hidden>
      <div class="widget-size-heading"><label for="widget-size-range">挂件大小</label><output id="widget-size-output" for="widget-size-range">${settings.widgetScale}%</output><button type="button" id="widget-size-reset" title="恢复 100%" aria-label="恢复原始大小">${icon('rotate-ccw')}</button><button type="button" id="widget-size-close" title="关闭大小设置" aria-label="关闭大小设置">${icon('x')}</button></div>
      <input id="widget-size-range" type="range" min="${MIN_WIDGET_SCALE}" max="${MAX_WIDGET_SCALE}" step="5" value="${settings.widgetScale}">
      <div class="widget-size-limits"><span>${MIN_WIDGET_SCALE}%</span><span>${MAX_WIDGET_SCALE}%</span></div>
    </div>
    <button type="button" class="widget-resize" id="widget-resize" role="slider" aria-label="拖动调整挂件大小" aria-orientation="horizontal" aria-valuemin="${MIN_WIDGET_SCALE}" aria-valuemax="${MAX_WIDGET_SCALE}" aria-valuenow="${settings.widgetScale}" title="拖动调整挂件大小">${icon('move-diagonal')}</button>
    <div id="widget-toast" class="widget-toast" role="status" hidden></div>
  </section>`;
  document.querySelector('.window-actions').insertAdjacentHTML('afterbegin', `<button id="widget-pet" title="挂件小八" aria-label="挂件小八" aria-controls="widget-companion" aria-pressed="${settings.widgetPetEnabled}">${icon('paw-print')}</button>`);
  document.getElementById('widget-pet').onclick = () => attempt(() => store.dispatch({ type: 'settings', patch: { widgetPetEnabled: !settings.widgetPetEnabled } }));
  companion = mountWidgetCompanion(document.getElementById('widget-companion'), () => {
    if (window.paydropDesktop) window.paydropDesktop.showPet();
    else window.location.href = new URL('./pet.html', window.location.href).href;
  });
  document.querySelector('.widget-display-options').insertAdjacentHTML('afterbegin', `<label class="widget-layout-label" for="widget-layout">挂件布局</label><select id="widget-layout"><option value="compact">紧凑</option><option value="standard">标准</option><option value="companion">陪伴</option></select>`);
  document.getElementById('widget-layout').onchange = event => attempt(() => store.dispatch({
    type: 'settings', patch: { widgetDensity: event.target.value === 'compact' ? 'compact' : 'standard',
      widgetPetEnabled: event.target.value === 'companion' }
  }));
  createIcons({ icons });
  bindWidgetSizing();
  applyTheme();
  document.querySelector('#widget-theme').onclick = () => attempt(cycleTheme);
  document.querySelector('#widget-pause').onclick = togglePause;
  document.querySelector('#widget-unfreeze').onclick = () => { if (paused) togglePause(); };
  document.querySelector('#widget-settings').onclick = () => {
    if (window.paydropDesktop) window.paydropDesktop.openDashboard();
    else window.location.href = new URL('./index.html?settings=1', window.location.href).href;
  };
  document.getElementById('widget-review').onclick = () => {
    const record = activeRecord(store.data.records);
    if (!record) return;
    if (window.paydropDesktop?.reviewRecord) window.paydropDesktop.reviewRecord(record.id);
    else if (window.paydropDesktop) window.paydropDesktop.openDashboard();
    else {
      const url = new URL('./index.html', window.location.href);
      url.searchParams.set('review', record.id);
      window.location.href = url.href;
    }
  };
  document.querySelector('#widget-minimize').onclick = () => window.paydropDesktop?.minimize();
  document.querySelector('#widget-close').onclick = () => window.paydropDesktop?.close();
  document.querySelector('#widget-close').title = settings.closeToTray ? '收起到托盘' : '退出挂件';
  document.querySelector('#widget-minimize').title = '收起到托盘';
  if (!window.paydropDesktop) {
    document.querySelector('#widget-minimize').hidden = true;
    document.querySelector('#widget-close').hidden = true;
  }
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
  const live = paused ? data() : result;
  const presentation = workPresentation(live);
  const update = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  update('widget-state', live.state);
  const calendarLabel = document.querySelector('.widget-label-right');
  calendarLabel.textContent = ['official', 'manual'].includes(live.calendarDay.source) ? live.calendarDay.label : result.mode === 'actual' ? '本班已记录' : '今日预计收入';
  calendarLabel.title = `${live.key} · ${live.calendarDay.label}${live.calendarDay.source === 'fallback' ? ' · 该年官方日历未收录' : ''}`;
  const earnedText = money(result.earned, settings.amountPrecision);
  const motion = !paused && settings.motion && !reducedMotion.matches;
  companion?.sync(live, { enabled: settings.widgetPetEnabled, paused: false,
    motion: settings.motion && !reducedMotion.matches, followWork: settings.petFollowWork });
  updateCountedAmount(document.getElementById('widget-earned'), result.earned, motion, allowCoin ? spawnWidgetCoin : undefined, settings.amountPrecision);
  const width = [...earnedText].reduce((total, char) => total + (/\d/.test(char) ? .74 : .3), 0);
  document.getElementById('widget-earned').style.fontSize = `${Math.min(39, Math.floor(210 / width))}px`;
  update('widget-rate', `${presentation.rateLabel} ¥${money(presentation.rate)} / 秒`);
  document.getElementById('widget-rate').title = `${presentation.detail}；标准秒薪 ¥${money(result.rate)} / 秒`;
  update('widget-rate-caption', result.mode === 'actual' ? '实际记录' : '作息估算');
  document.getElementById('widget-rate-caption').hidden = paused;
  document.getElementById('widget-unfreeze').hidden = !paused;
  update('widget-time-label', presentation.timerLabel);
  document.getElementById('widget-remaining').title = presentation.timerCaption;
  updateDigits(document.getElementById('widget-remaining'), duration(workPresentation(result).timerSeconds), motion, presentation.timerDirection);
  updateDigits(document.getElementById('widget-worked'), duration(result.worked), motion);
  updateDigits(document.getElementById('widget-unpaid'), duration(result.unpaid), motion);
  document.getElementById('widget-progress-fill').style.width = `${result.progress}%`;
  document.querySelector('.widget-card').dataset.state = live.state;
  const tier = coinTier(result.earned, result.daily);
  const pile = document.getElementById('coin-display');
  pile.dataset.tier = tier;
  pile.setAttribute('aria-label', `本班金币积累 ${Math.min(100, Math.floor(result.earned / result.daily * 100))}%`);
  if (previousTier !== null && tier > previousTier && motion) {
    pile.classList.remove('tier-up'); void pile.offsetWidth; pile.classList.add('tier-up');
  }
  previousTier = tier;
  const record = activeRecord(store.data.records), last = record?.segments.at(-1);
  const reminder = overtimeReminder(record, settings);
  const review = document.getElementById('widget-review');
  review.hidden = !reminder;
  if (reminder) review.title = reminder.message;
  const session = document.getElementById('widget-session');
  const signature = `${settings.trackingMode}|${record?.id}|${last?.kind}|${result.key}|${Date.now() >= result.endAt}`;
  if (session.dataset.signature !== signature) {
    const start = result.isWorkday && Date.now() < result.endAt;
    session.dataset.signature = signature;
    session.innerHTML = `<span>${result.key}</span><div>${record
      ? `<button class="widget-work-command" data-widget-work="${last.kind === 'break' ? 'resume' : 'break'}" title="${last.kind === 'break' ? '继续记录工作，按本班参数计薪' : '休息期间不累计收入与工作时长'}" aria-label="${last.kind === 'break' ? '继续工作' : '休息（不计薪）'}">${icon(last.kind === 'break' ? 'play' : 'coffee')}<span>${last.kind === 'break' ? '继续工作' : '休息（不计薪）'}</span></button>`
      : settings.trackingMode === 'actual' ? `<button class="widget-work-command" data-widget-work="${start ? 'start' : 'overtime'}" title="${start ? '开始工作记录' : '开始加班记录'}" aria-label="${start ? '开始工作' : '开始加班'}">${icon('play')}<span>${start ? '开始工作' : '开始加班'}</span></button>`
        : `<button id="widget-actual" title="切换到实际打卡" aria-label="切换到实际打卡">${icon('clipboard-check')}</button>`}</div>`;
    createIcons({ icons });
  }
}
function spawnWidgetCoin() {
  companion?.collectCoin();
  const coin = document.createElement('span');
  coin.className = 'widget-falling-coin';
  document.getElementById('widget-coins').appendChild(coin);
  coin.addEventListener('animationend', () => coin.remove());
}
store.subscribe(value => { settings = value.settings; applyTheme(); previousTier = null; tick(false); });
document.addEventListener('click', event => {
  const work = event.target.closest('[data-widget-work]');
  if (work && ['start', 'overtime', 'break', 'resume'].includes(work.dataset.widgetWork)) attempt(async () => {
    await store.dispatch({ type: 'work', action: work.dataset.widgetWork });
    if (paused) togglePause();
  });
  if (event.target.closest('#widget-actual')) attempt(() => store.dispatch({ type: 'settings', patch: { trackingMode: 'actual' } }));
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#widget-size-panel, #widget-size-toggle')) toggleSizePanel(false);
  if (!event.target.closest('#widget-display-menu')) document.getElementById('widget-display-menu').open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.getElementById('widget-display-menu').open) {
    document.getElementById('widget-display-menu').open = false;
    document.querySelector('#widget-display-menu summary').focus();
  }
  if (event.key === 'Escape' && !document.getElementById('widget-size-panel').hidden) {
    event.preventDefault(); toggleSizePanel(false, true);
  }
});
render();
reducedMotion.addEventListener('change', () => tick(false));
window.addEventListener('pagehide', event => { if (!event.persisted) companion?.destroy(); });
window.paydropDesktop?.onUpdateStatus?.(state => { updateEvents += 1; updateState = state; showUpdateState(); });
const initialUpdateEvents = updateEvents;
window.paydropDesktop?.getUpdateState?.().then(state => {
  if (updateEvents !== initialUpdateEvents) return;
  updateState = state;
  showUpdateState();
});
setInterval(tick, 1000);
setInterval(async () => {
  if (advancing || !activeRecord(store.data.records)) return;
  advancing = true;
  try { await store.dispatch({ type: 'advance' }); } catch (error) { await attempt(() => { throw error; }); }
  finally { advancing = false; }
}, 1000);
