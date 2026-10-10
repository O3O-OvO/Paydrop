import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizeSettings, settingsError, validatePatch } from './settings.js';
import { widgetHeight } from './widget-sizing.js';
import { mountSettingsNavigation } from './settings-navigation.js';

test('old settings retain their pet preference and receive standard density', () => {
  const saved = { ...defaults, dailySalary: 321, widgetPetEnabled: false };
  delete saved.widgetDensity;
  const next = normalizeSettings(saved);
  assert.equal(next.widgetDensity, 'standard');
  assert.equal(next.dailySalary, 321);
  assert.equal(next.widgetPetEnabled, false);
  assert.equal(settingsError(saved), '');
});

test('widget geometry covers compact, standard and companion layouts', () => {
  assert.equal(widgetHeight({ widgetDensity: 'compact', widgetPetEnabled: false }), 272);
  assert.equal(widgetHeight({ widgetDensity: 'standard', widgetPetEnabled: false }), 304);
  assert.equal(widgetHeight({ widgetDensity: 'standard', widgetPetEnabled: true }), 400);
  assert.equal(widgetHeight({ widgetDensity: 'compact', widgetPetEnabled: true }), 368);
  assert.throws(() => validatePatch(defaults, { widgetDensity: 'invalid' }), /布局/);
});

test('settings navigation preserves panels, supports keyboard, and reveals invalid fields', () => {
  const ids = ['pay', 'appearance', 'desktop', 'data'];
  const buttons = ids.map(id => ({ dataset: { settingsTab: id }, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; }, focus() { this.focused = true; } }));
  const panels = ids.map(id => ({ dataset: { settingsPanel: id }, draft: 'unchanged' }));
  let invalid;
  mountSettingsNavigation({
    querySelectorAll: selector => selector === '[data-settings-tab]' ? buttons : panels,
    querySelector: () => ({ closest: () => panels[2] }),
    addEventListener(type, listener, capture) { assert.equal(type, 'invalid'); assert.equal(capture, true); invalid = listener; }
  });
  assert.equal(panels[0].hidden, false);
  buttons[0].onkeydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(panels[3].hidden, false);
  assert.equal(buttons[3].focused, true);
  buttons[1].onclick();
  assert.equal(panels[1].hidden, false);
  invalid({ target: { closest: () => panels[2] } });
  invalid({ target: { closest: () => panels[0] } });
  assert.equal(panels[2].hidden, false);
  assert.equal(panels.filter(panel => !panel.hidden).length, 1);
  assert.ok(panels.every(panel => panel.draft === 'unchanged'));
});
