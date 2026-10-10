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

test('full restore keeps a separate pre-restore snapshot through later writes and reopen', async t => {
  const f = await fixture(t);
  const { normalizeData } = await import('../src/data-model.js');
  const { backupEnvelope } = await import('../src/record-management.js');
  const store = f.open();
  store.update({ type: 'settings', patch: { dailySalary: 333 } });
  const before = store.read().data;
  const result = store.update({ type: 'restore-backup', expectedRevision: before.revision, backup: backupEnvelope(normalizeData()) });
  assert.equal(result.ok, true);
  assert.equal(result.data.revision, before.revision + 1);
  store.update({ type: 'settings', patch: { theme: 'night' } });
  assert.deepEqual(f.open().readRestoreBackup().data, before);
  assert.equal(f.open().read().data.settings.dailySalary, 545.45);
});

test('restore snapshot write failure prevents replacing primary or notifying consumers', async t => {
  const f = await fixture(t);
  f.open().update({ type: 'settings', patch: { dailySalary: 333 } });
  const { normalizeData, applyOperation } = await import('../src/data-model.js');
  const { backupEnvelope } = await import('../src/record-management.js');
  const io = { ...fs, writeFileSync(file, ...args) {
    if (String(file).endsWith('.before-restore.tmp')) { const error = new Error('Disk full'); error.code = 'ENOSPC'; throw error; }
    return fs.writeFileSync(file, ...args);
  } };
  const store = createDataStore({ directory: f.directory, normalizeData, applyOperation, io, onChange: () => assert.fail('must not broadcast a failed restore') });
  const before = store.read().data;
  assert.equal(store.update({ type: 'restore-backup', backup: backupEnvelope(normalizeData()), expectedRevision: before.revision }).ok, false);
  assert.deepEqual(store.read().data, before);
  assert.deepEqual(f.open().read().data, before);
  assert.equal(fs.existsSync(path.join(f.directory, 'data.json.tmp')), false);
});

test('corrupt safety snapshots report an error without altering data', async t => {
  const f = await fixture(t);
  assert.equal(f.open().readRestoreBackup().data, null);
  fs.writeFileSync(path.join(f.directory, 'data.json.before-restore'), '{');
  const store = f.open();
  assert.equal(store.readRestoreBackup().ok, false);
  assert.equal(store.read().data.records.length, 0);
  assert.equal(fs.readFileSync(path.join(f.directory, 'data.json.before-restore'), 'utf8'), '{');
});

test('more than ten revisions persist through disk reload and full backup restore', async t => {
  const f = await fixture(t);
  const { backupEnvelope } = await import('../src/record-management.js');
  const store = f.open();
  const at = (hour, minute = 0) => new Date(2026, 9, 5, hour, minute);
  const now = new Date(2026, 9, 10, 12);
  assert.equal(store.update({ type: 'work', action: 'overtime' }, at(19)).ok, true);
  assert.equal(store.update({ type: 'work', action: 'end' }, at(22)).ok, true);
  const original = structuredClone(store.read().data.records[0]);
  for (let index = 0; index < 15; index++) {
    const record = structuredClone(store.read().data.records[0]);
    const end = at(20, index).getTime();
    const result = store.update({ type: 'correct-record', id: record.id, expected: record,
      patch: { date: record.date, segments: [{ ...record.segments[0], end }], finishedAt: end },
      reason: `Correction ${index}` }, now);
    assert.equal(result.ok, true, result.error);
  }
  const saved = structuredClone(store.read().data);
  assert.equal(saved.records[0].corrections.length, 15);
  assert.deepEqual(saved.records[0].corrections[0].previous.segments, original.segments);
  assert.deepEqual(f.open().read().data, saved);
  const reopened = f.open();
  assert.equal(reopened.update({ type: 'restore-backup', backup: backupEnvelope(saved, now), expectedRevision: saved.revision }, now).ok, true);
  assert.deepEqual(f.open().read().data.records, saved.records);
  assert.deepEqual(f.open().readRestoreBackup().data, saved);
});
