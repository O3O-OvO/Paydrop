const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDataStore } = require('./data-store.cjs');

async function fixture(t, io = fs) {
  const { normalizeData, applyOperation } = await import('../src/data-model.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paydrop-store-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()), 'paydrop-store-')));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const messages = [];
  const open = () => createDataStore({ directory, normalizeData, applyOperation, io, onChange: data => messages.push(data) });
  return { directory, open, messages };
}

test('atomic writes survive reopen and notify both consumers with new revisions', async t => {
  const f = await fixture(t);
  const store = f.open();
  assert.equal(store.update({ type: 'settings', patch: { theme: 'night' } }).ok, true);
  assert.equal(store.update({ type: 'settings', patch: { dailySalary: 720 } }).ok, true);
  assert.equal(f.open().read().data.settings.dailySalary, 720);
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[1].revision, 2);
  assert.equal(fs.existsSync(path.join(f.directory, 'data.json.tmp')), false);
});

test('broken primary file recovers previous backup without discarding records', async t => {
  const f = await fixture(t);
  const store = f.open();
  store.update({ type: 'work', action: 'start' }, new Date(2026, 9, 5, 9));
  store.update({ type: 'settings', patch: { theme: 'night' } });
  fs.writeFileSync(path.join(f.directory, 'data.json'), '{');
  const recovered = f.open();
  assert.match(recovered.read().issue, /恢复/);
  assert.equal(recovered.read().data.records.length, 1);
  assert.equal(recovered.update({ type: 'settings', patch: { dailySalary: 800 } }).ok, true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(f.directory, 'data.json.backup'), 'utf8')));
});

test('disk write failure leaves both memory and persistent primary unchanged', async t => {
  const f = await fixture(t);
  f.open().update({ type: 'settings', patch: { theme: 'night' } });
  const { normalizeData, applyOperation } = await import('../src/data-model.js');
  const store = createDataStore({
    directory: f.directory, normalizeData, applyOperation,
    io: { ...fs, renameSync: () => { const error = new Error('Access denied'); error.code = 'EACCES'; throw error; } },
  });
  const result = store.update({ type: 'settings', patch: { dailySalary: 1000 } });
  assert.equal(result.ok, false);
  assert.match(result.error, /保存失败/);
  assert.equal(store.read().data.settings.dailySalary, 545.45);
  assert.equal(f.open().read().data.settings.dailySalary, 545.45);
});

test('old installed settings migrate without modifying the original file', async t => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ dailySalary: 333, start: '08:00', end: '17:00', breaks: [] }));
  const store = f.open();
  assert.equal(store.read().data.settings.dailySalary, 333);
  store.update({ type: 'settings', patch: { sound: true } });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).dailySalary, 333);
});
