import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOperation, normalizeData } from './data-model.js';
import { normalizeSettings, settingsError } from './settings.js';

test('independent field patches do not overwrite changes from another window', () => {
  let state = normalizeData();
  const old = structuredClone(state.settings);
  state = applyOperation(state, { type: 'settings', patch: { theme: 'night' } });
  state = applyOperation(state, { type: 'settings', patch: { dailySalary: 1000 }, expected: old });
  assert.equal(state.settings.theme, 'night');
  assert.equal(state.settings.dailySalary, 1000);
});

test('conflicting edits are rejected instead of silently overwriting', () => {
  let state = normalizeData();
  const old = structuredClone(state.settings);
  state = applyOperation(state, { type: 'settings', patch: { dailySalary: 1000 } });
  assert.throws(() => applyOperation(state, { type: 'settings', patch: { dailySalary: 2000 }, expected: old }), /另一窗口/);
  assert.equal(state.settings.dailySalary, 1000);
});

test('unknown fields, invalid schedules and imported display values are rejected', () => {
  const state = normalizeData();
  assert.throws(() => applyOperation(state, { type: 'settings', patch: { injected: 'test' } }), /字段/);
  assert.throws(() => applyOperation(state, { type: 'settings', patch: { widgetOpacity: 0 } }), /有效范围/);
  assert.throws(() => applyOperation(state, { type: 'import-settings', settings: { start: 'invalid' } }), /时间/);
  assert.match(settingsError({ ...state.settings, exceptions: [{ date: '2026-02-30', working: false }] }), /日期/);
});

test('legacy breaks migrate and new fields are defaulted consistently', () => {
  const settings = normalizeSettings({ dailySalary: 500, breakStart: '12:00', breakEnd: '12:30' });
  assert.deepEqual(settings.breaks, [{ start: '12:00', end: '12:30' }]);
  assert.deepEqual(settings.workdays, [1, 2, 3, 4, 5]);
  assert.equal(settings.trackingMode, 'estimate');
});

test('embedded companion preference migrates without altering standalone pet or salary', () => {
  const legacy = normalizeData();
  delete legacy.settings.widgetPetEnabled;
  legacy.settings.dailySalary = 800;
  legacy.settings.petEnabled = false;
  const state = normalizeData(legacy);
  assert.equal(state.settings.widgetPetEnabled, true);
  const next = applyOperation(state, { type: 'settings', patch: { widgetPetEnabled: false } });
  assert.equal(next.settings.widgetPetEnabled, false);
  assert.equal(next.settings.petEnabled, false);
  assert.equal(next.settings.dailySalary, 800);
  assert.throws(() => applyOperation(state, { type: 'settings', patch: { widgetPetEnabled: 'yes' } }), /开关/);
});

test('active records prevent mode changes and config replacement', () => {
  let state = normalizeData();
  state = applyOperation(state, { type: 'work', action: 'start' }, new Date(2026, 9, 5, 9));
  assert.throws(() => applyOperation(state, { type: 'settings', patch: { trackingMode: 'actual' } }), /结束/);
  assert.throws(() => applyOperation(state, { type: 'import-settings', settings: {} }), /结束/);
  assert.throws(() => applyOperation(state, { type: 'delete-record', id: state.records[0].id }), /已结束/);
});

test('configuration import preserves history and validates rather than defaulting silently', () => {
  let state = normalizeData();
  const date = new Date(2026, 9, 5, 9);
  state = applyOperation(state, { type: 'work', action: 'start' }, date);
  state = applyOperation(state, { type: 'work', action: 'end' }, new Date(2026, 9, 5, 10));
  state = applyOperation(state, { type: 'import-settings', settings: { dailySalary: 800, theme: 'night' } });
  assert.equal(state.records.length, 1);
  assert.equal(state.settings.dailySalary, 800);
});

test('corrupt versioned data is rejected for backup recovery', () => {
  const state = normalizeData();
  assert.throws(() => normalizeData({ ...state, settings: { ...state.settings, dailySalary: -1 } }), /损坏/);
  assert.throws(() => normalizeData({ ...state, records: [{ id: '<script>' }] }), /损坏/);
  assert.throws(() => normalizeData({ ...state, schemaVersion: 99 }), /不兼容/);
});
