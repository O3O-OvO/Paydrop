const test = require('node:test');
const assert = require('node:assert/strict');
const { nextWalkPosition } = require('./pet-window.cjs');

test('native pet reverses without going outside the screen work area', () => {
  const area = { x: 0, width: 1920 };
  assert.deepEqual(nextWalkPosition(1600, 1, 40, area, 300), { x: 1620, direction: -1 });
  assert.deepEqual(nextWalkPosition(10, -1, 40, area, 300), { x: 0, direction: 1 });
});

test('native roaming supports negative monitor coordinates and oversized pets', () => {
  assert.deepEqual(nextWalkPosition(-1800, -1, 200, { x: -1920, width: 1920 }, 300), { x: -1920, direction: 1 });
  assert.deepEqual(nextWalkPosition(100, 1, 5, { x: 100, width: 100 }, 300), { x: 100, direction: -1 });
});
