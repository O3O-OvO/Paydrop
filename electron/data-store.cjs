const fs = require('node:fs');
const path = require('node:path');

function createDataStore({ directory, normalizeData, applyOperation, onChange = () => {}, io = fs }) {
  const file = path.join(directory, 'data.json');
  const backup = `${file}.backup`;
  let issue = '';
  let primaryValid = false;
  let data;
  try {
    data = normalizeData(JSON.parse(io.readFileSync(file, 'utf8')));
    primaryValid = true;
  } catch {
    try {
      data = normalizeData(JSON.parse(io.readFileSync(backup, 'utf8')));
      issue = '配置文件异常，已恢复上一次备份。';
    } catch {
      try { data = normalizeData({ settings: JSON.parse(io.readFileSync(path.join(directory, 'settings.json'), 'utf8')) }); }
      catch { data = normalizeData(); }
      if (io.existsSync(file)) issue = '配置与备份读取失败，已使用默认设置；原文件未删除。';
    }
  }
  function read() { return { data: structuredClone(data), issue }; }
  function readRestoreBackup() {
    const safety = `${file}.before-restore`;
    if (!io.existsSync(safety)) return { ok: true, data: null };
    try { return { ok: true, data: normalizeData(JSON.parse(io.readFileSync(safety, 'utf8'))) }; }
    catch { return { ok: false, error: '恢复前快照读取失败，原文件未删除。' }; }
  }
  function update(operation, now = new Date()) {
    try {
      const next = applyOperation(data, operation, now);
      if (next === data) return { ok: true, data: structuredClone(data) };
      io.mkdirSync(directory, { recursive: true });
      const temporary = `${file}.tmp`;
      try {
        io.writeFileSync(temporary, JSON.stringify(next), 'utf8');
        if (operation.type === 'restore-backup') {
          const safety = `${file}.before-restore`;
          io.writeFileSync(`${safety}.tmp`, JSON.stringify(data), 'utf8');
          io.renameSync(`${safety}.tmp`, safety);
        }
        if (primaryValid) io.copyFileSync(file, backup);
        io.renameSync(temporary, file);
      } catch (error) {
        try { io.unlinkSync(temporary); } catch {}
        try { io.unlinkSync(`${file}.before-restore.tmp`); } catch {}
        throw error;
      }
      data = next;
      primaryValid = true;
      issue = '';
      try { onChange(structuredClone(data)); } catch (error) { console.error('Data notification failed:', error); }
      return { ok: true, data: structuredClone(data) };
    } catch (error) {
      const known = error.code ? '保存失败，请检查磁盘空间和目录权限。' : error.message;
      return { ok: false, error: known };
    }
  }
  return { read, update, readRestoreBackup };
}

module.exports = { createDataStore };
