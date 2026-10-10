import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeData, applyOperation } from './data-model.js';
import { backupEnvelope } from './record-management.js';

let snapshotRead;
let operationSaved;
globalThis.window = {
  paydropDesktop: {
    onDataChanged() {},
    async readData() { return { data: normalizeData() }; },
    async readRestoreBackup() { return snapshotRead; },
    async updateData(operation) {
      operationSaved = operation;
      return { ok: true, data: applyOperation(store.data, operation) };
    },
  },
};
const { store } = await import('./client-store.js');
const { createRecordTools } = await import('./record-panel.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function data(salary) { return normalizeData({ settings: { dailySalary: salary } }); }
function contents(salary) { return JSON.stringify(backupEnvelope(data(salary))); }

// Minimal drawer nodes let these tests control read completion without browser timing.
async function fixture() {
  await store.init();
  operationSaved = null;
  const nodes = new Map();
  for (const id of ['export-backup', 'import-backup', 'backup-file', 'load-recovery', 'backup-preview', 'backup-error', 'restore-backup']) {
    nodes.set(`#${id}`, { isConnected: true, disabled: id === 'restore-backup', textContent: '', innerHTML: '', click() {} });
  }
  const checks = [{ checked: false }];
  const drawer = { inert: false, querySelector: selector => nodes.get(selector), querySelectorAll: () => checks };
  let closes = 0;
  const tools = createRecordTools({ show: () => drawer, close: () => { closes++; }, icon: () => '',
    refreshIcons() {}, toast() {}, download() {} });
  tools.backup();
  function select(read) {
    const input = nodes.get('#backup-file');
    input.files = [{ size: 1, text: () => read }];
    input.value = 'selected.json';
    return input.onchange({ target: input });
  }
  function snapshot(read) {
    snapshotRead = read.then(value => ({ ok: true, data: value }));
    return nodes.get('#load-recovery').onclick();
  }
  return { nodes, checks, drawer, select, snapshot, get closes() { return closes; } };
}

test('only the latest selected backup can preview and supply the restore operation', async () => {
  const f = await fixture();
  const old = deferred();
  const oldRead = f.select(old.promise);
  assert.equal(f.nodes.get('#backup-file').value, '');
  await f.select(Promise.resolve(contents(222)));
  f.checks[0].checked = true;
  f.checks[0].onchange();
  assert.equal(f.nodes.get('#restore-backup').disabled, false);
  old.resolve(contents(111));
  await oldRead;
  assert.match(f.nodes.get('#backup-preview').innerHTML, /222\.00/);
  assert.doesNotMatch(f.nodes.get('#backup-preview').innerHTML, /111\.00/);
  assert.equal(f.nodes.get('#restore-backup').disabled, false);
  await f.nodes.get('#restore-backup').onclick();
  assert.equal(operationSaved.backup.data.settings.dailySalary, 222);
  assert.equal(f.closes, 1);
});

test('an older failed file read cannot replace a newer preview with an error', async () => {
  const f = await fixture();
  const old = deferred();
  const oldRead = f.select(old.promise);
  await f.select(Promise.resolve(contents(222)));
  old.reject(new Error('Old read failed'));
  await oldRead;
  assert.equal(f.nodes.get('#backup-error').textContent, '');
  assert.match(f.nodes.get('#backup-preview').innerHTML, /222\.00/);
});

test('a failed latest selection stays failed even when an older valid read finishes', async () => {
  const f = await fixture();
  const old = deferred();
  const oldRead = f.select(old.promise);
  await f.select(Promise.resolve('{'));
  old.resolve(contents(111));
  await oldRead;
  assert.match(f.nodes.get('#backup-error').textContent, /JSON/);
  assert.equal(f.nodes.get('#backup-preview').innerHTML, '');
  assert.equal(f.nodes.get('#restore-backup').disabled, true);
});

test('snapshot and file reads share the same latest-request protection in both directions', async () => {
  const f = await fixture();
  const oldSnapshot = deferred();
  const readingSnapshot = f.snapshot(oldSnapshot.promise);
  await f.select(Promise.resolve(contents(222)));
  oldSnapshot.resolve(data(111));
  await readingSnapshot;
  assert.match(f.nodes.get('#backup-preview').innerHTML, /222\.00/);

  const oldFile = deferred();
  const readingFile = f.select(oldFile.promise);
  await f.snapshot(Promise.resolve(data(333)));
  oldFile.resolve(contents(444));
  await readingFile;
  assert.match(f.nodes.get('#backup-preview').innerHTML, /333\.00/);
  assert.doesNotMatch(f.nodes.get('#backup-preview').innerHTML, /444\.00/);
});

test('a stale snapshot failure cannot erase or annotate the latest file preview', async () => {
  const f = await fixture();
  const old = deferred();
  const reading = f.snapshot(old.promise);
  await f.select(Promise.resolve(contents(222)));
  old.reject(new Error('Old snapshot failed'));
  await reading;
  assert.equal(f.nodes.get('#backup-error').textContent, '');
  assert.match(f.nodes.get('#backup-preview').innerHTML, /222\.00/);
});

test('closed or replaced backup panels ignore late successful and failed reads', async () => {
  for (const replaced of [false, true]) {
    for (const failed of [false, true]) {
      const f = await fixture();
      const read = deferred();
      const reading = f.select(read.promise);
      if (replaced) f.nodes.get('#backup-error').isConnected = false;
      else f.drawer.inert = true;
      if (failed) read.reject(new Error('Read after close'));
      else read.resolve(contents(111));
      await reading;
      assert.equal(f.nodes.get('#backup-preview').innerHTML, '');
      assert.equal(f.nodes.get('#backup-error').textContent, '');
      assert.equal(f.nodes.get('#restore-backup').disabled, true);
    }
  }
});

test('new reads clear stale errors and confirmation before loading', async () => {
  const f = await fixture();
  await f.select(Promise.resolve('{'));
  const read = deferred();
  const reading = f.select(read.promise);
  assert.equal(f.nodes.get('#backup-error').textContent, '');
  assert.equal(f.nodes.get('#backup-preview').innerHTML, '');
  assert.equal(f.nodes.get('#restore-backup').disabled, true);
  read.resolve(contents(222));
  await reading;
  assert.match(f.nodes.get('#backup-preview').innerHTML, /222\.00/);
});
