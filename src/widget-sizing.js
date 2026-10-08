export const MIN_WIDGET_SCALE = 80;
export const MAX_WIDGET_SCALE = 150;

export function clampWidgetScale(value) {
  return Math.max(MIN_WIDGET_SCALE, Math.min(MAX_WIDGET_SCALE, Number(value) || 100));
}

export function scaleAfterDrag(initialScale, deltaX, deltaY, height) {
  const width = 380;
  // Project the drag onto the widget diagonal to preserve its proportions.
  const change = 100 * (deltaX * width + deltaY * height) / (width * width + height * height);
  return clampWidgetScale(Math.round((initialScale + change) / 5) * 5);
}
