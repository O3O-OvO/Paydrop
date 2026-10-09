import { normalizeSettings, validatePatch, defaults, settingsError } from './settings.js';
import { activeRecord, advanceRecords, workAction } from './work-log.js';

export function normalizeData(saved = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('数据文件格式无效。');
  if (saved.schemaVersion && saved.schemaVersion !== 3) throw new Error('数据版本不兼容，请安装匹配版本。');
  if (saved.schemaVersion === 3 && (!saved.settings || settingsError(saved.settings))) throw new Error('配置内容损坏。');
  if (saved.records !== undefined && (!Array.isArray(saved.records) || saved.records.length > 10000)) throw new Error('工作记录格式无效。');
  let active = 0;
  const ids = new Set();
  for (const record of saved.records || []) {
    if (!record || typeof record.id !== 'string' || !/^[\w-]{1,64}$/.test(record.id) || ids.has(record.id) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '') || !record.settings || settingsError(record.settings) || !Array.isArray(record.segments) || !record.segments.length || record.segments.length > 10000) throw new Error('工作记录内容损坏。');
    ids.add(record.id);
    if (record.finishedAt !== null && (!Number.isFinite(record.finishedAt) || record.finishedAt < 0)) throw new Error('工作记录结束时间无效。');
    if (record.finishedAt === null) active++;
    for (let index = 0; index < record.segments.length; index++) {
      const segment = record.segments[index];
      if (!segment || !['work', 'break', 'overtime'].includes(segment.kind) || !Number.isFinite(segment.start) || segment.start < 0 || (segment.end !== null && (!Number.isFinite(segment.end) || segment.end < segment.start)) || (segment.end === null && (index !== record.segments.length - 1 || record.finishedAt !== null)) || (index && (record.segments[index - 1].end === null || segment.start < record.segments[index - 1].end))) throw new Error('工作记录时段无效。');
      if (segment.resumeKind && !['work', 'overtime'].includes(segment.resumeKind)) throw new Error('休息恢复类型无效。');
    }
  }
  if (active > 1) throw new Error('不能同时存在多个进行中的班次。');
  return { schemaVersion: 3, revision: Number.isSafeInteger(saved.revision) ? saved.revision : 0, settings: normalizeSettings(saved.settings || saved), records: Array.isArray(saved.records) ? saved.records : [] };
}

export function applyOperation(current, operation, now = new Date()) {
  if (!operation || typeof operation !== 'object') throw new Error('操作无效。');
  let next = structuredClone(current);
  if (operation.type === 'settings') {
    const patch = operation.patch;
    // Compare only edited fields so a stale window cannot overwrite another window.
    for (const key of Object.keys(patch || {})) {
      if (operation.expected && key in operation.expected && JSON.stringify(current.settings[key]) !== JSON.stringify(operation.expected[key])) throw new Error('此字段已在另一窗口修改，请重新打开设置后再保存。');
    }
    const settings = validatePatch(current.settings, patch);
    if (activeRecord(current.records) && settings.trackingMode !== current.settings.trackingMode) throw new Error('请先结束当前记录，再切换计薪模式。');
    next.settings = settings;
  } else if (operation.type === 'work') {
    if (operation.expectedRecordId !== undefined && activeRecord(advanceRecords(current.records, now).records)?.id !== operation.expectedRecordId) {
      throw new Error('当前班次已变化，请重新确认操作。');
    }
    next.records = workAction(current.records, current.settings, operation.action, now);
  } else if (operation.type === 'advance') {
    const advanced = advanceRecords(current.records, now);
    if (!advanced.changed) return current;
    next.records = advanced.records;
  } else if (operation.type === 'delete-record') {
    const record = current.records.find(item => item.id === operation.id);
    if (!record || !record.finishedAt) throw new Error('只能删除已结束的记录。');
    next.records = next.records.filter(item => item.id !== operation.id);
  } else if (operation.type === 'import-settings') {
    const input = operation.settings;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置格式不正确。');
    const patch = Object.fromEntries(Object.entries(input).filter(([key]) => key in defaults));
    next.settings = validatePatch(normalizeSettings(), patch);
    if (activeRecord(current.records)) throw new Error('请先结束当前记录，再导入配置。');
  } else throw new Error('未知操作。');
  next.revision += 1;
  return next;
}
