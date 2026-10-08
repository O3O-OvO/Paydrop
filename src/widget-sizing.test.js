import assert from 'node:assert/strict';
import test from 'node:test';
import { clampWidgetScale, scaleAfterDrag } from './widget-sizing.js';

test('widget scaling preserves saved fractional percentages and clamps to safe limits', () => {
  assert.equal(clampWidgetScale(125), 125);
  assert.equal(clampWidgetScale(102.5), 102.5);
  assert.equal(clampWidgetScale(40), 80);
  assert.equal(clampWidgetScale(200), 150);
  assert.equal(clampWidgetScale(NaN), 100);
});

test('drag resize scales both expanded and compact widgets proportionally', () => {
  assert.equal(scaleAfterDrag(100, 38, 40, 400), 110);
  assert.equal(scaleAfterDrag(100, 38, 30.4, 304), 110);
  assert.equal(scaleAfterDrag(125, -38, -40, 400), 115);
  assert.equal(scaleAfterDrag(100, 2000, 2000, 400), 150);
  assert.equal(scaleAfterDrag(100, -2000, -2000, 304), 80);
  assert.equal(scaleAfterDrag(100, 1, 1, 400), 100);
});
