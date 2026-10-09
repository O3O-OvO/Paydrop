import assert from 'node:assert/strict';
import test from 'node:test';
import { WidgetCompanionBehavior } from './widget-companion-state.js';

const preferences = { enabled: true, paused: false, motion: true, followWork: true };
const result = state => ({ key: '2026-10-05', state });

test('widget companion stays in place and follows work and rest without changing records', () => {
  const brain = new WidgetCompanionBehavior();
  const work = result('工作中');
  brain.sync(work, preferences, 0);
  assert.equal(brain.mood(30000), 'idle');
  assert.deepEqual(work, result('工作中'));
  brain.sync(result('临时休息'), preferences, 31000);
  assert.equal(brain.mood(31000), 'stretch');
  assert.equal(brain.mood(34000), 'rest');
  brain.sync(result('工作中'), preferences, 35000);
  assert.equal(brain.mood(35000), 'wave');
  assert.equal(brain.mood(38000), 'idle');
  brain.sync(result('已下班'), preferences, 39000);
  assert.equal(brain.mood(39000), 'dance');
  assert.equal(brain.mood(42000), 'rest');
});

test('whole-yuan reactions do not interrupt a manually selected gesture', () => {
  const brain = new WidgetCompanionBehavior();
  brain.sync(result('工作中'), preferences, 0);
  brain.react('eat', 100);
  brain.collectCoin(300);
  assert.equal(brain.mood(300), 'eat');
  brain.collectCoin(4000);
  assert.equal(brain.mood(4000), 'coin');
  brain.collectCoin(4100);
  assert.equal(brain.brain.interaction.until, 6100);
  assert.equal(brain.mood(6200), 'idle');
});

test('pause, hidden companion and reduced motion suppress automatic reactions', () => {
  for (const patch of [{ paused: true }, { enabled: false }, { motion: false }]) {
    const brain = new WidgetCompanionBehavior();
    brain.sync(result('工作中'), { ...preferences, ...patch }, 0);
    brain.collectCoin(100);
    brain.sync(result('已下班'), { ...preferences, ...patch }, 200);
    assert.equal(brain.brain.interaction, null);
  }
  const brain = new WidgetCompanionBehavior();
  brain.sync(result('工作中'), preferences, 0);
  brain.react('dance', 100);
  brain.sync(result('工作中'), { ...preferences, paused: true }, 200);
  brain.react('wave', 250);
  assert.equal(brain.mood(300), 'idle');
  brain.sync(result('工作中'), preferences, 400);
  assert.equal(brain.mood(400), 'idle');
});

test('first load, a new shift date and disabled work following do not play false celebrations', () => {
  const brain = new WidgetCompanionBehavior();
  brain.sync(result('已下班'), preferences, 0);
  assert.equal(brain.mood(0), 'rest');
  brain.sync({ key: '2026-10-06', state: '工作中' }, preferences, 100);
  assert.equal(brain.mood(100), 'idle');
  brain.sync({ key: '2026-10-06', state: '已下班' }, { ...preferences, followWork: false }, 200);
  assert.equal(brain.mood(200), 'idle');
});

test('manual rest persists across work updates while gestures remain temporary', () => {
  const brain = new WidgetCompanionBehavior();
  brain.sync(result('工作中'), preferences, 0);
  brain.toggleRest();
  brain.react('wave', 100);
  assert.equal(brain.mood(200), 'wave');
  brain.sync(result('工作中'), preferences, 4000);
  assert.equal(brain.mood(4000), 'rest');
  brain.toggleRest();
  assert.equal(brain.mood(4100), 'idle');
});

test('automatic coins and schedule gestures cannot wake a manually resting companion', () => {
  const brain = new WidgetCompanionBehavior();
  brain.sync(result('工作中'), preferences, 0);
  brain.toggleRest();
  brain.collectCoin(100);
  assert.equal(brain.mood(100), 'rest');
  brain.sync(result('临时休息'), preferences, 200);
  assert.equal(brain.mood(200), 'rest');
  brain.sync(result('工作中'), preferences, 300);
  assert.equal(brain.mood(300), 'rest');
  brain.sync(result('已下班'), preferences, 400);
  assert.equal(brain.mood(400), 'rest');
  brain.react('eat', 500);
  assert.equal(brain.mood(500), 'eat');
  assert.equal(brain.mood(4100), 'rest');
});

test('a companion following planned rest does not celebrate money earned during a paid break', () => {
  const brain = new WidgetCompanionBehavior();
  brain.sync(result('休息中'), preferences, 0);
  brain.collectCoin(100);
  assert.equal(brain.mood(100), 'rest');
  brain.sync(result('工作中'), preferences, 200);
  assert.equal(brain.mood(200), 'wave');
  brain.collectCoin(3500);
  assert.equal(brain.mood(3500), 'coin');
});
