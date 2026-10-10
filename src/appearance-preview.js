import { widgetHeight } from './widget-sizing.js';
import { defaults } from './settings.js';

export function previewAppearance(draft) {
  const fields = ['theme', 'backgroundOpacity', 'widgetOpacity', 'widgetScale', 'widgetDensity', 'widgetPetEnabled', 'amountPrecision'];
  return Object.fromEntries(fields.map(key => [key, draft[key] ?? defaults[key]]));
}

export function mountAppearancePreview(form, readDraft) {
  const frame = form.querySelector('#appearance-preview');
  const stage = form.querySelector('#preview-stage');
  const output = form.querySelector('#preview-size');
  const update = () => {
    const draft = readDraft();
    const zoom = Math.max(.8, Math.min(1.5, (draft.widgetScale || 100) / 100));
    const width = 380 * zoom, height = widgetHeight(draft) * zoom;
    const fit = Math.min(((stage.clientWidth || 340) - 20) / width, (stage.clientHeight || 300) / height);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${fit})`;
    frame.style.left = `${Math.max(0, (stage.clientWidth - width * fit) / 2)}px`;
    output.textContent = `${Math.round(width)} × ${Math.round(height)} px · ${Math.round(zoom * 100)}%`;
    // Installed Electron pages use file: (opaque origin); the receiver also checks its parent.
    frame.contentWindow?.postMessage({ type: 'paydrop-appearance-preview', settings: previewAppearance(draft) }, window.location.protocol === 'file:' ? '*' : window.location.origin);
  };
  frame.addEventListener('load', update);
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  const observer = new ResizeObserver(update);
  observer.observe(stage);
  update();
  return () => {
    observer.disconnect();
    frame.removeEventListener('load', update);
    form.removeEventListener('input', update);
    form.removeEventListener('change', update);
    frame.remove();
  };
}
