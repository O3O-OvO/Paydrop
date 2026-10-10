import { normalizeSettings, validatePatch, defaults, settingsError } from './settings.js';
import { activeRecord, advanceRecords, workAction } from './work-log.js';
import { validateRecord, requireRecordMatch, requireNoConflict, correctedRecord, readBackup } from './record-management.js';

export function normalizeData(saved = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('数据文件格式无效。');
  if (saved.schemaVersion && saved.schemaVersion !== 3) throw new Error('数据版本不兼容，请安装匹配版本。');
  if (saved.schemaVersion === 3 && (!saved.settings || settingsError(saved.settings))) throw new Error('配置内容损坏。');
  if (saved.records !== undefined && (!Array.isArray(saved.records) || saved.records.length > 10000)) throw new Error('工作记录格式无效。');
  let active = 0;
  const ids = new Set();
  for (const record of saved.records || []) {
    validateRecord(record);
    if (ids.has(record.id)) throw new Error('工作记录 ID 重复。');
    ids.add(record.id);
    if (record.finishedAt === null) active++;
  }
  const archivedRecords = saved.archivedRecords === undefined ? [] : saved.archivedRecords;
  if (!Array.isArray(archivedRecords) || archivedRecords.length > 10000) throw new Error('已删除记录格式无效。');
  for (const entry of archivedRecords) {
    if (!entry || !Number.isSafeInteger(entry.deletedAt) || entry.deletedAt < 0 || entry.deletedAt > 8640000000000000) throw new Error('删除时间无效。');
    validateRecord(entry.record);
    if (entry.record.finishedAt === null || ids.has(entry.record.id)) throw new Error('已删除记录状态无效。');
    ids.add(entry.record.id);
  }
  if (active > 1) throw new Error('不能同时存在多个进行中的班次。');
  return { schemaVersion: 3, revision: Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0, settings: normalizeSettings(saved.settings || saved), records: Array.isArray(saved.records) ? saved.records : [], archivedRecords };
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
    if (!record || record.finishedAt === null) throw new Error('只能删除已结束的记录。');
    requireRecordMatch(record, operation.expected);
    if ((next.archivedRecords?.length || 0) >= 10000) throw new Error('已删除记录已满，请导出备份。');
    next.archivedRecords = [{ record: structuredClone(record), deletedAt: now.getTime() }, ...(next.archivedRecords || [])];
    next.records = next.records.filter(item => item.id !== operation.id);
  } else if (operation.type === 'restore-record') {
    const entry = current.archivedRecords?.find(item => item.record.id === operation.id);
    requireRecordMatch(entry?.record, operation.expected);
    if (current.records.length >= 10000) throw new Error('工作记录已满。');
    requireNoConflict(entry.record, current.records);
    next.records.unshift(structuredClone(entry.record));
    next.archivedRecords = next.archivedRecords.filter(item => item.record.id !== operation.id);
  } else if (operation.type === 'correct-record') {
    const record = current.records.find(item => item.id === operation.id);
    requireRecordMatch(record, operation.expected);
    const candidate = correctedRecord(record, operation.patch, operation.reason, now);
    requireNoConflict(candidate, current.records);
    next.records = next.records.map(item => item.id === record.id ? candidate : item);
  } else if (operation.type === 'add-record') {
    if (operation.expectedRevision !== current.revision) throw new Error('数据已变化，请重新打开补卡后再保存。');
    if (current.records.length >= 10000) throw new Error('工作记录已满。');
    if (current.records.some(item => item.id === operation.id) || current.archivedRecords?.some(item => item.record.id === operation.id)) throw new Error('记录 ID 重复。');
    const candidate = correctedRecord({ id: operation.id, date: operation.patch?.date, settings: structuredClone(current.settings), segments: [], finishedAt: null, origin: 'manual' }, operation.patch, operation.reason, now);
    requireNoConflict(candidate, current.records);
    next.records.unshift(candidate);
  } else if (operation.type === 'restore-backup') {
    if (operation.expectedRevision !== current.revision) throw new Error('数据已在另一窗口变化，请重新预览备份。');
    if (activeRecord(current.records)) throw new Error('请先核对并结束当前班次，再恢复完整备份。');
    const imported = readBackup(operation.backup, normalizeData);
    if (activeRecord(imported.records) && operation.resumeActive !== true) throw new Error('备份含进行中的班次，须明确确认继续原班次。');
    next = { ...structuredClone(imported), revision: current.revision };
  } else if (operation.type === 'import-settings') {
    const input = operation.settings;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置格式不正确。');
    const patch = Object.fromEntries(Object.entries(input).filter(([key]) => key in defaults));
    next.settings = validatePatch(normalizeSettings(), patch);
    if (activeRecord(current.records)) throw new Error('请先结束当前记录，再导入配置。');
  } else throw new Error('未知操作。');
  if (!Number.isSafeInteger(current.revision) || current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('数据版本计数异常，请先导出完整备份。');
  next.revision += 1;
  return next;
}
