import './amount-counter.css';

const counters = new WeakMap();
const DURATION = 700;
const MAX_STEPS = 12;

function formatAmount(units, precision = 4) {
  return (units / 10000).toLocaleString('zh-CN', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

function stepSize(delta) {
  if (delta >= 10000) return 10000;
  if (delta >= 1000) return 100;
  if (delta >= 100) return 10;
  return 1;
}

function settle(element, state, units) {
  state.displayed = units;
  const text = formatAmount(units, state.precision);
  updateDisplay(element, text);
  element.setAttribute('aria-label', text);
}

function createDisplay(text) {
  const display = document.createElement('span');
  display.className = 'amount-digits';
  display.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < text.length; index++) {
    const slot = document.createElement('span');
    if (!/\d/.test(text[index])) {
      slot.className = 'amount-separator';
      slot.textContent = text[index];
    } else {
      slot.className = 'amount-digit';
      const staticDigit = document.createElement('span');
      staticDigit.className = 'amount-digit-static';
      staticDigit.textContent = text[index];
      slot.append(staticDigit);
    }
    display.append(slot);
  }
  return display;
}

function updateDisplay(element, text) {
  let display = element.firstElementChild;
  if (!display?.classList.contains('amount-digits') || display.children.length !== text.length) {
    display = createDisplay(text);
    element.replaceChildren(display);
    return;
  }
  for (let index = 0; index < text.length; index++) {
    const slot = display.children[index];
    if (!slot.classList.contains('amount-digit')) continue;
    if (slot.childElementCount === 1 && slot.firstElementChild.textContent === text[index]) continue;
    const digit = document.createElement('span');
    digit.className = 'amount-digit-static';
    digit.textContent = text[index];
    slot.replaceChildren(digit);
  }
}

function rollStep(element, to, precision) {
  const next = formatAmount(to, precision);
  updateDisplay(element, next);
  element.setAttribute('aria-label', next);
}

export function updateCountedAmount(element, target, animate = true, onWholeYuan, precision = 4) {
  if (!element || !Number.isFinite(target)) return;
  const roundedTarget = Math.round(target * 10000);
  let state = counters.get(element);
  if (!state) {
    state = { displayed: roundedTarget, target: roundedTarget, timer: null, precision };
    counters.set(element, state);
    settle(element, state, roundedTarget);
    return;
  }
  const precisionChanged = state.precision !== precision;
  state.precision = precision;
  if (state.target === roundedTarget && animate && !precisionChanged) return;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  state.target = roundedTarget;

  const delta = roundedTarget - state.displayed;
  const unit = Math.max(stepSize(delta), Math.ceil(delta / MAX_STEPS));
  const steps = Math.ceil(delta / unit);
  if (!animate || document.hidden || delta <= 0 || precisionChanged) {
    settle(element, state, roundedTarget);
    return;
  }
  if (!steps) return;
  const start = state.displayed;
  if (formatAmount(start, precision).length !== formatAmount(roundedTarget, precision).length) {
    settle(element, state, roundedTarget);
    if (Math.floor(start / 10000) < Math.floor(roundedTarget / 10000)) onWholeYuan?.();
    return;
  }
  const stepDuration = DURATION / steps;
  let index = 0;
  const next = () => {
    if (!element.isConnected) { state.timer = null; return; }
    const from = state.displayed;
    const to = Math.min(roundedTarget, start + (index + 1) * unit);
    rollStep(element, to, precision);
    state.displayed = to;
    if (Math.floor(from / 10000) < Math.floor(to / 10000)) onWholeYuan?.();
    index += 1;
    state.timer = setTimeout(() => {
      if (index < steps) next();
      else { state.timer = null; settle(element, state, roundedTarget); }
    }, stepDuration);
  };
  next();
}
