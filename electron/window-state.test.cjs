const assert = require('node:assert/strict');
const test = require('node:test');
const { fitBounds } = require('./window-state.cjs');

test('enlarged widget stays within the work area', () => {
  assert.deepEqual(fitBounds({ x: 1510, y: 30, width: 475, height: 380 }, { x: 0, y: 0, width: 1920, height: 1080 }), { x: 1445, y: 30, width: 475, height: 380 });
});
test('secondary displays with negative coordinates preserve valid positions', () => {
  const bounds = { x: -1000, y: 100, width: 380, height: 304 };
  assert.deepEqual(fitBounds(bounds, { x: -1920, y: 0, width: 1920, height: 1080 }), bounds);
});
