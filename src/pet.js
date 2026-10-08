import { createIcons, Heart, Cookie, Coffee, Play, Pause, X, PawPrint, Settings2, PictureInPicture2, Move, RotateCcw, Coins, Pin, Hand, Accessibility, Music2, Ellipsis } from 'lucide';
import './pet.css';
import { store } from './client-store.js';
import { currentCalculation } from './work-log.js';
import { PetBehavior, moodLabels, stepWithin } from './pet-behavior.js';
import { createSpritePlayer } from './pet-sprites.js';

const desktop = window.paydropDesktop;
const icons = { Heart, Cookie, Coffee, Play, Pause, X, PawPrint, Settings2, PictureInPicture2, Move, RotateCcw, Coins, Pin, Hand, Accessibility, Music2, Ellipsis };
const extraActions = [
  { name: 'wave', label: '挥手', glyph: 'hand', message: '你好呀！我在这里。' },
  { name: 'stretch', label: '伸懒腰', glyph: 'accessibility', message: '伸个懒腰，放松一下。' },
  { name: 'dance', label: '开心摇摆', glyph: 'music-2', message: '嘿嘿，开心地摇一摇！' },
  { name: 'coin', label: '抱金币', glyph: 'coins', message: '把今天的小收获抱好。' },
];
const native = Boolean(desktop);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
let settings = (await store.init()).settings;
const brain = new PetBehavior(performance.now());
let calculation = currentCalculation(settings, store.data.records);
let hovered = false, drag = null, hidden = false, mood = '', bubbleUntil = 0, nativeActivity = '';
let direction = 1, x = 0, y = 0, initialized = false, previousEarned = null;
let placedByUser = false;
let lastFrame = performance.now(), toastTimer, lastPassthrough = null;
const icon = name => `<i data-lucide="${name}"></i>`;
document.body.dataset.native = native;

function action(name, label, glyph) {
  return `<button type="button" class="pet-action" data-action="${name}" title="${label}" aria-label="${label}">${icon(glyph)}</button>`;
}
const petMarkup = `<div id="desktop-pet" class="desktop-pet" data-mood="idle">
  <div class="pet-bubble" id="pet-bubble" role="status"></div>
  <span class="pet-shadow"></span>
  <button class="pet-figure" id="pet-figure" data-pet-interactive title="摸摸小八" aria-label="摸摸小八">
    <span class="pet-facing"><canvas class="pet-sprite" id="pet-sprite" width="256" height="288" role="img" aria-label="小八"></canvas></span>
  </button>
  <div class="pet-effects" id="pet-effects" aria-hidden="true">
    <span class="pet-rest-symbol">${icon('coffee')}</span>
    <span class="pet-heart">${icon('heart')}</span>
  </div>
  <div class="pet-extra-actions" id="pet-extra-actions" data-pet-interactive role="group" aria-label="更多动作" hidden>
    ${extraActions.map(item => action(item.name, item.label, item.glyph)).join('')}
  </div>
  <div class="pet-tools" data-pet-interactive role="toolbar" aria-label="桌宠操作">
    ${action('pet', '摸摸小八', 'heart')}${action('feed', '喂小八吐司', 'cookie')}
    ${action('rest', '休息 / 继续陪伴', 'coffee')}${action('roam', '自由散步', 'pause')}
    ${action('widget', '打开记薪挂件', 'picture-in-picture-2')}${action('settings', '打开设置', 'settings-2')}
    <button type="button" id="pet-more" data-action="more" title="更多动作" aria-label="更多动作" aria-expanded="false" aria-controls="pet-extra-actions">${icon('ellipsis')}</button>
    ${action('hide', '收起桌宠', 'x')}
  </div>
</div>`;

document.getElementById('pet-app').innerHTML = native ? petMarkup : `
  <div class="pet-shell">
    <aside class="pet-sidebar">
      <div class="pet-brand"><img src="./hachiware-face.png" alt=""><div><strong>小八的陪伴</strong><span>PAYDROP / DESKTOP COMPANION</span></div></div>
      <h2>和小八互动</h2>
      <div class="pet-actions">${action('pet', '摸摸小八', 'heart')}${action('feed', '喂小八吐司', 'cookie')}${action('rest', '休息 / 继续陪伴', 'coffee')}${action('reset', '回到原位', 'rotate-ccw')}</div>
      <div class="pet-actions pet-extra-shortcuts">${extraActions.map(item => action(item.name, item.label, item.glyph)).join('')}</div>
      <h2>陪伴偏好</h2>
      <label class="pet-setting"><span>自由散步</span><input id="pet-roam" data-setting="petRoam" type="checkbox"></label>
      <label class="pet-setting"><span>跟随工作与休息</span><input id="pet-follow" data-setting="petFollowWork" type="checkbox"></label>
      <label class="pet-setting"><span>动态效果</span><input id="pet-motion" data-setting="motion" type="checkbox"></label>
      <label class="pet-range" for="pet-scale"><span>桌宠大小<output id="pet-scale-output" for="pet-scale"></output></span><input id="pet-scale" data-setting="petScale" type="range" min="70" max="140" step="5"></label>
      <label class="pet-range" for="pet-opacity"><span>桌宠不透明度<output id="pet-opacity-output" for="pet-opacity"></output></span><input id="pet-opacity" data-setting="petOpacity" type="range" min="30" max="100" step="5"></label>
      <div class="pet-status" id="pet-status">陪伴中</div>
      <div class="pet-links"><a href="./widget.html">${icon('picture-in-picture-2')}记薪挂件</a><a href="./index.html?settings=1">${icon('settings-2')}工作台设置</a></div>
    </aside>
    <main class="pet-stage" id="pet-stage">
      <div class="pet-stage-header"><h1>小八桌宠</h1><span id="pet-work-state"></span></div>
      <div class="pet-live"><small>本班收入</small><strong id="pet-earned"></strong></div>
      <div class="pet-ground"></div>
      ${petMarkup}
      <button class="pet-restore" id="pet-restore" hidden>${icon('paw-print')} 唤回小八</button>
      <div class="pet-stage-footer">${icon('paw-print')}小八 · HACHIWARE</div>
    </main>
  </div>`;
const pet = document.getElementById('desktop-pet');
const figure = document.getElementById('pet-figure');
const bubble = document.getElementById('pet-bubble');
const stage = document.getElementById('pet-stage');
const spritePlayer = createSpritePlayer(document.getElementById('pet-sprite'));
createIcons({ icons });

function motionEnabled() { return settings.motion && !reduced.matches; }
function scale(value = settings.petScale) { return native ? 1 : Math.min(value / 100, stage.clientWidth / 300); }
function toast(message) {
  let element = document.getElementById('pet-toast');
  if (!element) { element = document.createElement('div'); element.id = 'pet-toast'; element.className = 'pet-toast'; element.setAttribute('role', 'alert'); document.body.append(element); }
  element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
}
async function patch(patch) {
  try { await store.dispatch({ type: 'settings', patch }); }
  catch (error) { toast(error.message); applySettings(); }
}
function speak(text, duration = 2600) {
  bubble.textContent = text;
  bubbleUntil = performance.now() + duration;
  bubble.classList.add('visible');
}
function bounds(s = scale()) {
  return { maxX: Math.max(0, stage.clientWidth - 300 * s), maxY: Math.max(0, stage.clientHeight - 280 * s) };
}
function place(reset = false) {
  if (native) return;
  const b = bounds();
  if (!initialized || reset) {
    x = b.maxX * .5;
    y = Math.min(b.maxY, Math.max(0, stage.clientHeight * .8 - 235 * scale()));
    initialized = true;
  }
  x = Math.min(b.maxX, Math.max(0, x)); y = Math.min(b.maxY, Math.max(0, y));
  pet.style.transform = `translate(${x}px, ${y}px) scale(${scale()})`;
}
function applySettings() {
  pet.style.opacity = settings.petOpacity / 100;
  pet.classList.toggle('pet-still', !motionEnabled());
  document.querySelectorAll('[data-setting]').forEach(input => {
    if (input.type === 'checkbox') input.checked = settings[input.dataset.setting];
    else input.value = settings[input.dataset.setting];
  });
  for (const [id, key] of [['pet-scale-output', 'petScale'], ['pet-opacity-output', 'petOpacity']]) {
    const output = document.getElementById(id); if (output) output.value = `${settings[key]}%`;
  }
  document.querySelectorAll('[data-action="roam"]').forEach(button => {
    button.setAttribute('aria-pressed', String(settings.petRoam));
    button.title = settings.petRoam ? '暂停散步' : '开启散步';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = icon(settings.petRoam ? 'pause' : 'play');
  });
  createIcons({ icons });
  place();
}
function refreshWork() {
  calculation = currentCalculation(settings, store.data.records);
  const earned = Math.floor(calculation.earned);
  // Only celebrate a newly crossed yuan, not initial loads or large clock corrections.
  if (previousEarned !== null && earned === previousEarned + 1 && motionEnabled() && !hidden) {
    const coin = document.createElement('span');
    coin.className = 'pet-coin'; coin.innerHTML = icon('coins');
    document.getElementById('pet-effects').append(coin); createIcons({ icons });
    setTimeout(() => coin.remove(), 1000);
  }
  previousEarned = earned;
  if (!native) {
    document.getElementById('pet-work-state').textContent = calculation.state;
    document.getElementById('pet-earned').textContent = `¥${calculation.earned.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
function syncActivity(value) {
  const activity = value === 'walk' && !hidden ? 'walk' : 'idle';
  if (native && activity !== nativeActivity) { nativeActivity = activity; desktop.petActivity(activity); }
}
function frame(now) {
  const dt = Math.min(80, Math.max(0, now - lastFrame)); lastFrame = now;
  const next = brain.update(now, { dragging: Boolean(drag?.moved), hovered, roam: settings.petRoam, motion: motionEnabled(), followWork: settings.petFollowWork, workState: calculation.state });
  if (next !== mood) {
    mood = next; pet.dataset.mood = next;
    if (!native) document.getElementById('pet-status').textContent = hidden ? '已收起' : moodLabels[next];
    if (next === 'rest' && now > bubbleUntil) speak('歇一会儿，我陪着你。', 2300);
  }
  syncActivity(next);
  spritePlayer.render(now, next, motionEnabled() && !hidden);
  if (next === 'walk' && !native && !hidden) {
    const result = stepWithin(x, direction, dt * .045, 0, bounds().maxX);
    x = result.position; direction = result.direction; place();
  }
  pet.style.setProperty('--pet-direction', direction);
  if (now > bubbleUntil) bubble.classList.remove('visible');
  requestAnimationFrame(frame);
}
function toggleExtraActions(open, restoreFocus = false) {
  const panel = document.getElementById('pet-extra-actions');
  panel.hidden = !open;
  document.getElementById('pet-more').setAttribute('aria-expanded', String(open));
  if (open) {
    pet.classList.add('tools-open');
    panel.querySelector('button').focus({ preventScroll: true });
  } else {
    pet.classList.remove('tools-open');
    if (restoreFocus) document.getElementById('pet-more').focus({ preventScroll: true });
  }
}
function interact(name) {
  const extra = extraActions.find(item => item.name === name);
  if (hidden && (['pet', 'feed', 'rest'].includes(name) || extra)) restore();
  if (name === 'more') { toggleExtraActions(document.getElementById('pet-extra-actions').hidden); return; }
  if (extra) {
    const fromPanel = !document.getElementById('pet-extra-actions').hidden;
    toggleExtraActions(false, fromPanel);
    brain.react(name, performance.now());
    speak(extra.message);
  }
  if (name === 'pet') { brain.react('happy', performance.now()); speak('嘿嘿！今天也要一起加油。'); }
  if (name === 'feed') { brain.react('eat', performance.now()); speak('是吐司！谢谢你，好好吃。', 3500); }
  if (name === 'rest') {
    brain.toggleRest();
    document.querySelectorAll('[data-action="rest"]').forEach(button => button.setAttribute('aria-pressed', String(brain.resting)));
    speak(brain.resting ? '一起歇一会儿吧。' : '休息好啦，继续陪着你！');
  }
  if (name === 'roam') patch({ petRoam: !settings.petRoam });
  if (name === 'reset') { placedByUser = false; place(true); speak('我回到这里啦。'); }
  if (name === 'hide') {
    toggleExtraActions(false);
    if (native) desktop.hidePet();
    else { hidden = true; pet.hidden = true; document.getElementById('pet-restore').hidden = false; document.getElementById('pet-status').textContent = '已收起'; }
    syncActivity('idle');
  }
  if (name === 'widget') {
    if (native) desktop.revealWidget();
    else location.href = new URL('./widget.html', location.href).href;
  }
  if (name === 'settings') {
    if (native) desktop.openDashboard();
    else location.href = new URL('./index.html?settings=1', location.href).href;
  }
}
function restore() {
  hidden = false; pet.hidden = false; document.getElementById('pet-restore').hidden = true;
  mood = ''; place(true); speak('我回来啦！');
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target) interact(target.dataset.action);
});
document.addEventListener('pointerdown', event => {
  if (!document.getElementById('pet-extra-actions').hidden && !event.target.closest('.pet-extra-actions, #pet-more')) toggleExtraActions(false);
});
document.querySelectorAll('[data-setting]').forEach(input => {
  input.addEventListener('input', () => {
    if (input.type !== 'range') return;
    const value = Number(input.value);
    if (input.dataset.setting === 'petOpacity') pet.style.opacity = value / 100;
    if (input.dataset.setting === 'petScale') {
      const s = scale(value), b = bounds(s);
      pet.style.transform = `translate(${Math.min(x, b.maxX)}px, ${Math.min(y, b.maxY)}px) scale(${s})`;
    }
    document.getElementById(`${input.id}-output`).value = `${value}%`;
  });
  input.addEventListener('change', () => patch({ [input.dataset.setting]: input.type === 'checkbox' ? input.checked : Number(input.value) }));
});
document.getElementById('pet-restore')?.addEventListener('click', restore);
pet.addEventListener('pointerenter', () => { hovered = true; });
pet.addEventListener('pointerleave', () => { hovered = false; pet.classList.remove('tools-open'); });
figure.addEventListener('contextmenu', event => { event.preventDefault(); pet.classList.toggle('tools-open'); });
figure.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, x, y, moved: false };
  figure.setPointerCapture(event.pointerId);
});
figure.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.originX, dy = event.clientY - drag.originY;
  if (!drag.moved && Math.hypot(dx, dy) > 5) {
    drag.moved = true;
    placedByUser = true;
    if (native) desktop.petDrag('start');
    syncActivity('idle');
  }
  if (!drag.moved || native) return;
  x = drag.x + dx; y = drag.y + dy; place();
});
function endDrag(event, cancelled = false) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const moved = drag.moved; drag = null;
  if (native && moved) desktop.petDrag('end');
  if (figure.hasPointerCapture(event.pointerId)) figure.releasePointerCapture(event.pointerId);
  if (!cancelled && !moved) interact('pet');
  else if (!cancelled) speak('就在这里陪你吧。', 1700);
}
figure.addEventListener('pointerup', event => endDrag(event));
figure.addEventListener('pointercancel', event => endDrag(event, true));
figure.addEventListener('lostpointercapture', event => endDrag(event, true));
figure.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); interact('pet'); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    toggleExtraActions(false, !document.getElementById('pet-extra-actions').hidden);
    if (drag) endDrag({ pointerId: drag.pointerId }, true);
  }
});
if (native) {
  desktop.onPetDirection(value => { direction = value; });
  // Forward mouse moves through the transparent area so the desktop stays usable.
  document.addEventListener('mousemove', event => {
    const passthrough = !drag && !event.target.closest('[data-pet-interactive]');
    if (passthrough !== lastPassthrough) { lastPassthrough = passthrough; desktop.petPassthrough(passthrough); }
  });
  window.addEventListener('blur', () => { if (drag) endDrag({ pointerId: drag.pointerId }, true); });
} else {
  new ResizeObserver(() => place(!placedByUser)).observe(stage);
}
reduced.addEventListener('change', applySettings);
store.subscribe(data => {
  if (settings.petEnabled !== data.settings.petEnabled || settings.petRoam !== data.settings.petRoam || settings.motion !== data.settings.motion) nativeActivity = '';
  settings = data.settings; applySettings(); refreshWork();
});
applySettings(); refreshWork();
if (store.issue) toast(store.issue);
spritePlayer.ready.then(result => {
  if (result.errors.length) toast('部分桌宠动作素材未加载，已保留备用立绘。');
});
speak('你好呀，今天让我陪着你。', 3200);
requestAnimationFrame(frame);
setInterval(refreshWork, 1000);
