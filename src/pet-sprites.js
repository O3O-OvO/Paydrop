export const FRAME_WIDTH = 256;
export const FRAME_HEIGHT = 288;
export const animations = {
  idle: { durations: [1800, 180, 70, 110, 70, 500], poster: 0 },
  walk: { durations: [120, 120, 120, 120, 120, 120], poster: 0 },
  happy: { durations: [100, 120, 130, 170, 100, 130], poster: 0, loops: 2 },
  eat: { durations: [260, 180, 190, 260, 260, 260], poster: 0, loops: 2 },
  rest: { file: 'rest-soft.png', durations: [1100, 900, 1000, 1100, 900, 1100], poster: 2 },
  wave: { durations: [240, 160, 220, 220, 220, 260], poster: 0, loops: 2 },
  stretch: { durations: [250, 350, 450, 600, 300, 250], poster: 0, loops: 1 },
  dance: { durations: [180, 180, 180, 200, 180, 180], poster: 0, loops: 2 },
  coin: { durations: [260, 240, 420, 420, 260, 260], poster: 0, loops: 1 },
};

export function frameAt(animation, elapsed, moving = true) {
  if (!moving) return animation.poster;
  const duration = animation.durations.reduce((total, value) => total + value, 0);
  if (animation.loops && elapsed >= duration * animation.loops) return animation.durations.length - 1;
  let time = Math.max(0, elapsed) % duration;
  for (let index = 0; index < animation.durations.length; index++) {
    if (time < animation.durations[index]) return index;
    time -= animation.durations[index];
  }
  return 0;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`桌宠素材加载失败：${url}`));
    image.src = new URL(url, document.baseURI).href;
  });
}

export function createSpritePlayer(canvas) {
  const context = canvas.getContext('2d');
  const images = new Map();
  let fallback, lastDraw = '', started = 0, current = '';
  canvas.width = FRAME_WIDTH; canvas.height = FRAME_HEIGHT;
  const jobs = Object.keys(animations).map(async name => {
    const image = await loadImage(`./pet-art/v2/${animations[name].file || `${name}.png`}`);
    if (image.naturalWidth !== FRAME_WIDTH * 6 || image.naturalHeight !== FRAME_HEIGHT) throw new Error(`桌宠帧尺寸无效：${name}`);
    images.set(name, image);
  });
  const fallbackJob = loadImage('./paydrop-mascot-cutout.png').then(image => { fallback = image; });
  return {
    restart() { current = ''; },
    ready: Promise.allSettled([...jobs, fallbackJob]).then(results => {
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
      return { loaded: images.size, errors };
    }),
    render(now, mood, moving) {
      const name = mood in animations ? mood : 'idle';
      if (current !== name) { current = name; started = now; lastDraw = ''; }
      const animation = animations[name], image = images.get(name);
      const index = frameAt(animation, now - started, moving && mood !== 'drag');
      const key = image ? `${name}:${index}` : fallback ? 'fallback' : 'empty';
      if (key === lastDraw || key === 'empty') return;
      lastDraw = key;
      context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      if (image) {
        context.drawImage(image, index * FRAME_WIDTH, 0, FRAME_WIDTH, FRAME_HEIGHT, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        canvas.dataset.source = 'generated';
        canvas.dataset.animation = name;
        canvas.dataset.frame = index;
      } else {
        const height = 242, width = height * fallback.naturalWidth / fallback.naturalHeight;
        context.drawImage(fallback, (FRAME_WIDTH - width) / 2, 274 - height, width, height);
        canvas.dataset.source = 'fallback';
        delete canvas.dataset.frame;
      }
    },
  };
}
