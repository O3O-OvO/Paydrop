const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createUpdateService } = require('./updater.cjs');

function setup(enabled = true) {
  const updater = new EventEmitter();
  const handlers = new Map();
  const messages = [];
  const scheduled = [];
  let checks = 0;
  let installs = 0;
  updater.checkForUpdates = async () => {
    checks += 1;
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '1.1.1' });
  };
  updater.quitAndInstall = () => { installs += 1; };
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.1.0' },
    enabled,
    updater,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    windows: () => [{ isDestroyed: () => false, webContents: { send: (...message) => messages.push(message) } }],
    scheduler: {
      setTimeout: (callback, ms) => { scheduled.push({ callback, ms }); return { unref() {} }; },
      setInterval: () => ({ unref() {} }),
    },
  });
  return { updater, handlers, messages, scheduled, service, getChecks: () => checks, getInstalls: () => installs };
}

test('checks, downloads, and installs only once after the update is ready', async () => {
  const fixture = setup();
  assert.equal(fixture.service.getState().phase, 'idle');
  assert.equal(fixture.scheduled[0].ms, 15_000);
  await fixture.handlers.get('update:check')();
  assert.equal(fixture.getChecks(), 1);
  assert.equal(fixture.service.getState().phase, 'downloading');
  fixture.updater.emit('download-progress', { percent: 67.9 });
  assert.equal(fixture.handlers.get('update:get-state')().percent, 68);
  assert.equal(fixture.handlers.get('update:install')(), false);
  fixture.updater.emit('update-downloaded', { version: '1.1.1' });
  assert.equal(fixture.handlers.get('update:get-state')().availableVersion, '1.1.1');
  await fixture.service.check();
  assert.equal(fixture.getChecks(), 1);
  assert.equal(fixture.handlers.get('update:install')(), true);
  assert.equal(fixture.handlers.get('update:install')(), false);
  fixture.scheduled.find(item => item.ms === 0).callback();
  assert.equal(fixture.getInstalls(), 1);
  assert.ok(fixture.messages.some(([channel, state]) => channel === 'update:status' && state.phase === 'ready'));
});

test('portable and development builds never contact the update provider', async () => {
  const fixture = setup(false);
  assert.equal(fixture.service.getState().phase, 'unavailable');
  await fixture.handlers.get('update:check')();
  assert.equal(fixture.getChecks(), 0);
  assert.equal(fixture.scheduled.length, 0);
});

test('no available update reports the installed version as current', async () => {
  const fixture = setup();
  fixture.updater.checkForUpdates = async () => fixture.updater.emit('update-not-available', { version: '1.1.0' });
  await fixture.service.check();
  assert.equal(fixture.service.getState().phase, 'current');
  assert.equal(fixture.service.getState().currentVersion, '1.1.0');
});
