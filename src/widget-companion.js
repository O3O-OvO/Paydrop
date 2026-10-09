import { createSpritePlayer } from './pet-sprites.js';
import { moodLabels, restMessage } from './pet-behavior.js';
import { WidgetCompanionBehavior } from './widget-companion-state.js';

export const companionActions = [
  { name: 'wave', label: '挥手', icon: 'hand', message: '你好呀，今天也一起加油。' },
  { name: 'eat', label: '喂小八吐司', icon: 'cookie', message: '谢谢你的小点心！' },
  { name: 'stretch', label: '伸懒腰', icon: 'accessibility', message: '伸个懒腰，放松一下。' },
  { name: 'dance', label: '开心摇摆', icon: 'music-2', message: '嘿嘿，开心地摇一摇！' },
  { name: 'coin', label: '抱金币', icon: 'coins', message: '把今天的小收获抱好。' },
];

export function companionMarkup() {
  return `<section class="widget-companion" id="widget-companion" aria-label="小八陪伴">
    <button type="button" class="widget-companion-figure" id="widget-companion-figure" title="摸摸小八" aria-label="摸摸小八">
      <canvas id="widget-companion-sprite" width="256" height="288" role="img" aria-label="小八"></canvas>
    </button>
    <div class="widget-companion-content">
      <div class="widget-companion-heading"><strong>小八</strong><span id="widget-companion-state">陪伴中</span>
        <button type="button" id="widget-companion-popout" title="打开独立桌宠" aria-label="打开独立桌宠"><i data-lucide="external-link"></i></button>
      </div>
      <p class="widget-companion-message" id="widget-companion-message">今天也陪着你。</p>
      <div class="widget-companion-actions" role="toolbar" aria-label="小八互动">
        ${companionActions.map(item => `<button type="button" data-companion-action="${item.name}" title="${item.label}" aria-label="${item.label}"><i data-lucide="${item.icon}"></i></button>`).join('')}
        <button type="button" data-companion-action="rest" title="让小八歇一会（不暂停计薪）" aria-label="小八休息 / 继续陪伴" aria-pressed="false"><i data-lucide="coffee"></i></button>
      </div>
    </div>
  </section>`;
}

export function mountWidgetCompanion(host, openPet) {
  const brain = new WidgetCompanionBehavior();
  const player = createSpritePlayer(host.querySelector('canvas'));
  const state = host.querySelector('#widget-companion-state');
  const message = host.querySelector('#widget-companion-message');
  const restButton = host.querySelector('[data-companion-action="rest"]');
  let active = true, stopped = false, frame = null, speakingUntil = 0, previousMood = '';
  let preferences = { enabled: true, paused: false, motion: true, followWork: true };
  const speak = text => { message.textContent = text; speakingUntil = performance.now() + 3000; };

  function draw(now) {
    const mood = brain.mood(now);
    if (mood !== previousMood) {
      previousMood = mood;
      host.dataset.mood = mood;
      state.textContent = preferences.paused ? '展示暂停' : moodLabels[mood];
      host.querySelector('canvas').setAttribute('aria-label', `${moodLabels[mood]}的小八`);
    }
    if (now >= speakingUntil) {
      const text = preferences.paused ? '陪你安静待一会儿。'
        : mood === 'rest' ? restMessage(brain.previous?.state, brain.resting) : '今天也陪着你。';
      if (message.textContent !== text) message.textContent = text;
    }
    player.render(now, mood, preferences.motion && !preferences.paused);
  }

  function animate(now) {
    frame = null;
    if (stopped || !active) return;
    draw(now);
    frame = requestAnimationFrame(animate);
  }

  function setActive(value) {
    active = value;
    if (!value && frame !== null) { cancelAnimationFrame(frame); frame = null; }
    if (value && frame === null && !stopped) frame = requestAnimationFrame(animate);
  }

  function canAnimate() {
    return preferences.enabled && preferences.motion && !preferences.paused && !document.hidden;
  }

  function onClick(event) {
    if (event.target.closest('#widget-companion-popout')) { openPet(); return; }
    if (preferences.paused) return;
    if (event.target.closest('#widget-companion-figure')) {
      player.restart();
      brain.react('happy', performance.now()); speak('嘿嘿，摸摸好开心。');
    }
    const button = event.target.closest('[data-companion-action]');
    if (!button) { draw(performance.now()); return; }
    if (button.dataset.companionAction === 'rest') {
      brain.toggleRest();
      restButton.setAttribute('aria-pressed', String(brain.resting));
      restButton.title = brain.resting ? '让小八继续陪伴（不改变计薪）' : '让小八歇一会（不暂停计薪）';
      speak(brain.resting ? '让我歇一会儿。' : '休息好了，继续陪着你。');
    } else {
      const action = companionActions.find(item => item.name === button.dataset.companionAction);
      if (action) { player.restart(); brain.react(action.name, performance.now()); speak(action.message); }
    }
    draw(performance.now());
  }

  host.addEventListener('click', onClick);
  const onVisibility = () => {
    setActive(canAnimate());
    if (preferences.enabled && !document.hidden) draw(performance.now());
  };
  document.addEventListener('visibilitychange', onVisibility);
  player.ready.then(({ errors }) => {
    if (!stopped && errors.length) {
      message.textContent = '部分动作暂不可用。'; speakingUntil = Infinity;
      console.warn(errors.join('\n'));
    } else if (!stopped && preferences.enabled && !document.hidden) draw(performance.now());
  });

  return {
    sync(result, value) {
      const changed = preferences.paused !== value.paused;
      preferences = value;
      brain.sync(result, value, performance.now());
      host.hidden = !value.enabled;
      host.querySelectorAll('[data-companion-action], #widget-companion-figure').forEach(button => { button.disabled = value.paused; });
      if (changed) { previousMood = ''; speakingUntil = 0; }
      setActive(canAnimate());
      if (value.enabled && !document.hidden) draw(performance.now());
    },
    collectCoin() { brain.collectCoin(performance.now()); },
    destroy() {
      stopped = true;
      setActive(false);
      host.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
