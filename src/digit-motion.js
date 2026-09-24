import './digit-motion.css';

export function updateDigits(element, value, animate = true, direction = 'up') {
  if (!element) return;
  const previous = element.dataset.digitValue;
  element.dataset.digitValue = value;
  if (previous === value) return;
  const canAnimate = animate && previous && previous.length === value.length;

  element.setAttribute('aria-label', value);
  const display = document.createElement('span');
  display.className = `digit-display digit-${direction}`;
  display.setAttribute('aria-hidden', 'true');

  for (let index = 0; index < value.length; index++) {
    const next = value[index];
    if (canAnimate && next !== previous[index] && /\d/.test(next) && /\d/.test(previous[index])) {
      const slot = document.createElement('span');
      slot.className = 'digit-slot';
      slot.textContent = next;
      display.append(slot);
    } else {
      const stable = document.createElement('span');
      stable.className = /\d/.test(next) ? 'digit-stable' : 'digit-stable digit-punctuation';
      stable.textContent = next;
      display.append(stable);
    }
  }
  element.replaceChildren(display);
}
