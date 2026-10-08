import assert from 'node:assert/strict';
import test from 'node:test';
import { PetBehavior, stepWithin, workMood, reactionDurations } from './pet-behavior.js';
import { defaults, normalizeSettings, validatePatch, settingsError } from './settings.js';
import { normalizeData } from './data-model.js';

test('pet follows work breaks but does not change salary settings', () => {
  assert.equal(workMood('临时休息', true), 'rest');
  assert.equal(workMood('已下班', true), 'rest');
  assert.equal(workMood('待打卡', true), 'rest');
  assert.equal(workMood('工作中', true), 'idle');
  assert.equal(workMood('休息中', false), 'idle');
});

test('roaming is bounded in time and pauses on hover or reduced motion', () => {
  const pet = new PetBehavior(0);
  assert.equal(pet.update(8000), 'idle');
  assert.equal(pet.update(9000), 'walk');
  assert.equal(pet.update(10000, { hovered: true }), 'idle');
  assert.equal(pet.update(20000, { motion: false }), 'idle');
  assert.equal(pet.update(40000, { roam: false }), 'idle');
});

test('clicks, food, manual rest and dragging have predictable precedence', () => {
  const pet = new PetBehavior(0);
  pet.react('eat', 100);
  assert.equal(pet.update(200, { workState: '休息中' }), 'eat');
  assert.equal(pet.update(200, { dragging: true }), 'drag');
  assert.equal(pet.update(4000, { workState: '休息中' }), 'rest');
  pet.toggleRest();
  assert.equal(pet.update(5000, { followWork: false }), 'rest');
  pet.react('happy', 5000);
  assert.equal(pet.update(5100), 'happy');
  assert.equal(pet.update(7000), 'rest');
});

test('walking reverses at either boundary, including negative monitor coordinates', () => {
  assert.deepEqual(stepWithin(95, 1, 10, 0, 100), { position: 100, direction: -1 });
  assert.deepEqual(stepWithin(-1915, -1, 10, -1920, -300), { position: -1920, direction: 1 });
  assert.deepEqual(stepWithin(0, -1, 10, 0, 0), { position: 0, direction: 1 });
});

test('extra actions play temporarily and return to the previous rest preference', () => {
  for (const kind of ['wave', 'stretch', 'dance', 'coin']) {
    const pet = new PetBehavior(0);
    pet.toggleRest();
    pet.react(kind, 100);
    assert.equal(pet.update(200), kind);
    assert.equal(pet.update(200, { dragging: true }), 'drag');
    assert.equal(pet.update(100 + reactionDurations[kind]), 'rest');
    assert.equal(pet.resting, true);
  }
});

test('unknown reaction names cannot overwrite an active animation', () => {
  const pet = new PetBehavior(0);
  pet.react('wave', 100);
  pet.react('constructor', 200);
  pet.react('not-an-action', 200);
  assert.equal(pet.update(300), 'wave');
});

test('old v3 settings and salary snapshots remain valid without pet preferences', () => {
  const legacy = structuredClone(defaults);
  for (const key of Object.keys(legacy).filter(key => key.startsWith('pet'))) delete legacy[key];
  assert.equal(settingsError(legacy), '');
  assert.equal(normalizeData({ schemaVersion: 3, settings: legacy, records: [] }).settings.petEnabled, false);
  assert.equal(normalizeSettings(legacy).dailySalary, legacy.dailySalary);
});

test('pet settings are validated and preserved by the existing store schema', () => {
  const settings = validatePatch(defaults, { petEnabled: true, petScale: 120, petOpacity: 60 });
  assert.equal(normalizeSettings(settings).petScale, 120);
  assert.throws(() => validatePatch(defaults, { petRoam: 'yes' }), /桌宠/);
  assert.throws(() => validatePatch(defaults, { petScale: 200 }), /桌宠/);
  assert.throws(() => validatePatch(defaults, { petScale: undefined }), /桌宠/);
});
