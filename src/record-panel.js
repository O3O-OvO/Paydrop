import { store } from './client-store.js';
import { applyOperation, normalizeData } from './data-model.js';
import { calculateRecord, activeRecord } from './work-log.js';
import { dateKey, shiftFor } from './schedule.js';
import { backupEnvelope, readBackup, finishRecordPatch } from './record-management.js';
import { calendarName } from './china-calendar.js';

const kinds = { work: '普通工作', break: '临时无薪休息', overtime: '加班' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const currency = value => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function hours(value) {
  const seconds = Math.max(0, Math.floor(value));
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(item => String(item).padStart(2, '0')).join(':');
}
function localTime(timestamp) {
  if (timestamp === null) return '';
  const date = new Date(timestamp);
  return `${dateKey(date)}T${[date.getHours(), date.getMinutes(), date.getSeconds()].map(item => String(item).padStart(2, '0')).join(':')}`;
}
const timeText = value => value === null ? '进行中' : localTime(value).replace('T', ' ');
const header = (title, icon) => `<div class="drawer-header"><div><span>工作记录</span><h2>${title}</h2></div><button class="icon-button close-drawer" aria-label="关闭">${icon('x')}</button></div>`;
function timeline(record) {
  return `<ol class="record-timeline">${record.segments.map(segment => `<li data-kind="${segment.kind}"><strong>${kinds[segment.kind]}</strong><span>${timeText(segment.start)}<br>${timeText(segment.end)}</span></li>`).join('')}</ol>`;
}
function timelineOverview(record) {
  if (record.segments.length <= 4) return timeline(record);
  const last = record.segments.at(-1);
  return `<div class="record-focus"><p class="record-note">${last.end === null ? '当前进行中' : '最后一段'}</p>${timeline({ segments: [last] })}</div>
    <details class="record-audit"><summary>此前 ${record.segments.length - 1} 段打卡</summary>${timeline({ segments: record.segments.slice(0, -1) })}</details>`;
}
const backupStampKey = 'paydrop:last-backup-export';
function backupStamp() {
  try {
    const value = Number(localStorage.getItem(backupStampKey));
    return value > 0 && Number.isFinite(value) ? `本设备最近发起完整备份：${timeText(value)}` : '本设备尚无完整备份导出记录';
  } catch { return '无法读取本设备备份时间'; }
}
function snapshot(record) {
  const plan = record.settings;
  return `<dl class="record-snapshot"><div><dt>日薪</dt><dd>¥${currency(Number(plan.dailySalary))}</dd></div><div><dt>计划作息</dt><dd>${plan.start}–${plan.end}</dd></div><div><dt>工作日历</dt><dd>${calendarName(plan.workCalendar)}</dd></div><div><dt>加班计薪</dt><dd>${plan.paidOvertime ? `${plan.overtimeMultiplier} 倍` : '无薪'}</dd></div><div><dt>计划休息</dt><dd>${plan.breaks.length ? plan.breaks.map(rest => `${rest.start}–${rest.end}（${rest.paid ? '有薪' : '无薪'}）`).join('、') : '无'}</dd></div></dl>`;
}
function metrics(value) {
  return `<div class="record-metrics"><div><span>记录收入</span><strong>¥${currency(value.earned)}</strong></div><div><span>工作时长</span><strong>${hours(value.worked)}</strong></div><div><span>加班时长</span><strong>${hours(value.overtime)}</strong></div><div><span>无薪时长</span><strong>${hours(value.unpaid)}</strong></div></div>`;
}
function audit(record) {
  if (!record.corrections?.length) return '';
  return `<h3 class="record-section-title">修订历史</h3>${record.corrections.map((entry, index) => `<details class="record-audit"><summary>第 ${index + 1} 次 · ${timeText(entry.at)}</summary><p>${escape(entry.reason)}</p>${entry.previous ? `<h4>修订前时段 · ${entry.previous.date}</h4>${timeline(entry.previous)}` : '<p>手动补录，使用补录时的薪资与作息。</p>'}</details>`).join('')}`;
}
function segmentRow(segment, index, icon) {
  return `<div class="record-segment-row" data-start="${segment.start}" data-end="${segment.end ?? ''}"><label class="field">第 ${index + 1} 段<select name="segmentKind" aria-label="第 ${index + 1} 段类型">${Object.entries(kinds).map(([kind, label]) => `<option value="${kind}" ${kind === segment.kind ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="field">开始<input type="datetime-local" step="1" name="segmentStart" value="${localTime(segment.start)}" aria-label="第 ${index + 1} 段开始" required></label>
    <label class="field">结束<input type="datetime-local" step="1" name="segmentEnd" value="${localTime(segment.end)}" aria-label="第 ${index + 1} 段结束" required></label>
    <button type="button" class="icon-button" data-remove-segment title="删除时段" aria-label="删除第 ${index + 1} 段">${icon('trash-2')}</button></div>`;
}
function comparison(before, after) {
  const rows = [['收入（元）', currency(before?.earned || 0), currency(after.earned)], ['工作时长', hours(before?.worked || 0), hours(after.worked)], ['加班时长', hours(before?.overtime || 0), hours(after.overtime)], ['无薪时长', hours(before?.unpaid || 0), hours(after.unpaid)]];
  return `<h3 class="record-section-title">变更预览</h3><table class="record-comparison"><thead><tr><th>项目</th><th>原记录</th><th>保存后</th></tr></thead><tbody>${rows.map(([label, a, b]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table><p class="record-note">保存后为已结束班次，不会重新开启计薪。</p>`;
}

// The drawer owns its draft. Live dashboard refreshes never replace these inputs.
export function createRecordTools({ show, close, icon, refreshIcons, toast, download }) {
  function detail(id) {
    const source = store.data.records.find(record => record.id === id);
    if (!source) return toast('记录已变化，请重新选择。');
    const record = structuredClone(source);
    const value = calculateRecord(record);
    const drawer = show(`${header(record.date, icon)}<div class="drawer-body record-body"><div class="record-meta">${record.finishedAt === null ? '进行中 · 核对时刻快照' : '已结束'}${record.origin === 'manual' ? ' · 手动补卡' : ''}</div>${metrics(value)}<h3 class="record-section-title">实际打卡时段</h3>${timelineOverview(record)}<details class="record-audit"><summary>本班计薪参数 · 日薪 ¥${currency(Number(record.settings.dailySalary))}</summary>${snapshot(record)}</details>${audit(record)}</div><div class="drawer-footer"><span class="record-note">本班参数不会随新设置改变</span><button class="save-button" id="edit-record">${icon('settings-2')} 修正打卡</button></div>`, '班次详情');
    drawer.querySelector('#edit-record').onclick = () => editor(record.id);
  }

  function editor(id, { finishOnly = false } = {}) {
    const baseline = structuredClone(store.data);
    const original = id ? baseline.records.find(record => record.id === id) : null;
    if (id && !original) return toast('记录已变化，请重新选择。');
    if (finishOnly && (!original || original.finishedAt !== null)) return toast('此班次已结束，请重新查看记录。');
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const date = original?.date || dateKey(yesterday);
    const plan = original?.settings || baseline.settings;
    const shift = shiftFor(plan, new Date(), date);
    const initial = original?.segments || [{ kind: 'work', start: shift.startAt, end: shift.endAt }];
    const newId = original?.id || crypto.randomUUID();
    let preview = null;
    const title = finishOnly ? '补填结束时间' : original ? '修正打卡' : '补录班次';
    const drawer = show(`${header(title, icon)}<form id="record-form"><div class="drawer-body record-body">
      <p class="record-note">${original ? '沿用本班日薪和作息；原始时段将保留在修订历史中。' : '使用当前日薪和作息；同日期已有记录请直接修正原班次。'}</p>
      <label class="field">班次日期<input name="recordDate" type="date" value="${date}" required ${original ? 'readonly' : ''}></label>
      <details class="record-audit"><summary>计薪参数 · 日薪 ¥${currency(Number(plan.dailySalary))}</summary>${snapshot({ settings: plan })}</details>
      ${finishOnly ? `<dl class="record-snapshot"><div><dt>最后一段开始</dt><dd>${timeText(initial.at(-1).start)}</dd></div><div><dt>记录状态</dt><dd>${kinds[initial.at(-1).kind]} · 未结束</dd></div></dl>
      <label class="field">实际结束时间<input name="actualEnd" type="datetime-local" step="1" required></label>
      <p class="record-note">只补填最后一段的结束时间；此前 ${initial.length - 1} 段保持不变。</p>
      <button type="button" class="text-link" id="edit-all-segments">${icon('settings-2')} 修改其他打卡时段</button>` : `
      <div class="record-section-heading"><h3 class="record-section-title">实际打卡时段</h3><button type="button" class="text-link" id="add-segment">${icon('plus')} 添加时段</button></div>
      <div id="record-segments">${initial.map((segment, index) => segmentRow(segment, index, icon)).join('')}</div>`}
      <label class="field">修正原因<textarea name="recordReason" maxlength="200" rows="2" required placeholder="${original ? '例如：忘记结束加班，实际于 20:30 下班' : '例如：昨日漏打卡'}"></textarea></label>
      <div id="record-preview" aria-live="polite"></div><div id="record-error" class="form-error" role="alert"></div>
      </div><div class="drawer-footer"><button class="outline-button" type="button" id="preview-record">${icon('info')} 核对变更</button><button type="submit" class="save-button" disabled>${icon('check')} 保存记录</button></div></form>`, title);
    const form = drawer.querySelector('#record-form');
    const list = drawer.querySelector('#record-segments');
    const save = form.querySelector('[type="submit"]');
    const error = drawer.querySelector('#record-error');
    function invalidate() { preview = null; save.disabled = true; drawer.querySelector('#record-preview').innerHTML = ''; error.textContent = ''; }
    form.addEventListener('input', invalidate);
    form.addEventListener('change', invalidate);
    if (!original) {
      let previousDate = date;
      form.elements.recordDate.addEventListener('change', () => {
        const previous = shiftFor(plan, new Date(), previousDate);
        const nextDate = form.elements.recordDate.value;
        if (!nextDate) return;
        const row = list.children[0];
        // Move the untouched suggested shift when the user selects another date.
        if (list.children.length === 1 && new Date(row.querySelector('[name="segmentStart"]').value).getTime() === previous.startAt
          && new Date(row.querySelector('[name="segmentEnd"]').value).getTime() === previous.endAt) {
          const selected = shiftFor(plan, new Date(), nextDate);
          row.querySelector('[name="segmentStart"]').value = localTime(selected.startAt);
          row.querySelector('[name="segmentEnd"]').value = localTime(selected.endAt);
        }
        previousDate = nextDate;
      });
    }
    if (finishOnly) drawer.querySelector('#edit-all-segments').onclick = () => {
      if ((form.elements.actualEnd.value || form.elements.recordReason.value) && !confirm('切换后将丢弃当前未保存的补填内容，继续修改全部时段？')) return;
      editor(id);
    };
    if (!finishOnly) drawer.querySelector('#add-segment').onclick = () => {
      if (list.children.length >= 100) { error.textContent = '单次编辑最多 100 段。'; return; }
      const lastEnd = list.lastElementChild.querySelector('[name="segmentEnd"]').value;
      const start = lastEnd ? new Date(lastEnd).getTime() : shift.endAt;
      list.insertAdjacentHTML('beforeend', segmentRow({ kind: 'break', start, end: start }, list.children.length, icon));
      invalidate(); refreshIcons();
      list.lastElementChild.querySelector('select').focus();
    };
    if (list) list.onclick = event => {
      const remove = event.target.closest('[data-remove-segment]');
      if (!remove) return;
      if (list.children.length === 1) { error.textContent = '至少保留一段打卡时段。'; return; }
      remove.closest('.record-segment-row').remove();
      [...list.children].forEach((row, index) => {
        row.querySelector('label').firstChild.textContent = `第 ${index + 1} 段`;
        row.querySelector('select').setAttribute('aria-label', `第 ${index + 1} 段类型`);
        row.querySelector('[name="segmentStart"]').setAttribute('aria-label', `第 ${index + 1} 段开始`);
        row.querySelector('[name="segmentEnd"]').setAttribute('aria-label', `第 ${index + 1} 段结束`);
        row.querySelector('[data-remove-segment]').setAttribute('aria-label', `删除第 ${index + 1} 段`);
      });
      invalidate();
    };
    function operation() {
      if (finishOnly) return { type: 'correct-record', id: original.id, expected: original,
        patch: finishRecordPatch(original, new Date(form.elements.actualEnd.value).getTime()), reason: form.elements.recordReason.value };
      const readTime = (row, name) => {
        const value = new Date(row.querySelector(`[name="segment${name}"]`).value).getTime();
        const originalTime = row.dataset[name.toLowerCase()];
        // Editing another field must not round an untouched real punch to whole seconds.
        return originalTime !== '' && Math.floor(Number(originalTime) / 1000) * 1000 === value ? Number(originalTime) : value;
      };
      const segments = [...list.children].map((row, index) => {
        const kind = row.querySelector('select').value;
        const previousKind = list.children[index - 1]?.querySelector('select').value;
        return { kind, start: readTime(row, 'Start'), end: readTime(row, 'End'),
          ...(kind === 'break' ? { resumeKind: previousKind === 'overtime' ? 'overtime' : 'work' } : {}) };
      });
      return { type: original ? 'correct-record' : 'add-record', id: newId,
        ...(original ? { expected: original } : { expectedRevision: baseline.revision }),
        patch: { date: form.elements.recordDate.value, segments, finishedAt: segments.at(-1).end },
        reason: form.elements.recordReason.value };
    }
    drawer.querySelector('#preview-record').onclick = () => {
      if (!form.reportValidity()) return;
      try {
        const checkedAt = new Date();
        preview = operation();
        const result = applyOperation(store.data, preview, checkedAt);
        const candidate = result.records.find(record => record.id === newId);
        drawer.querySelector('#record-preview').innerHTML = comparison(original ? calculateRecord(original, checkedAt) : null, calculateRecord(candidate, checkedAt));
        error.textContent = ''; save.disabled = false;
      } catch (failure) { preview = null; save.disabled = true; error.textContent = failure.message; }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (!preview) return;
      save.disabled = true;
      try {
        await store.dispatch(preview);
        if (form.isConnected && !drawer.inert) detail(newId);
        toast('记录已保存，原时段保留在修订历史中');
      }
      catch (failure) { error.textContent = failure.message; }
      finally { if (save.isConnected) save.disabled = !preview; }
    };
  }

  function recycle() {
    const entries = structuredClone(store.data.archivedRecords || []);
    const drawer = show(`${header('已删除记录', icon)}<div class="drawer-body record-body"><p class="record-note">不计入汇总；恢复后仍为已结束班次。</p>
      ${entries.length ? `<ul class="record-recycle">${entries.map(entry => `<li><div><strong>${entry.record.date}</strong><span>¥${currency(calculateRecord(entry.record).earned)} · 删除于 ${timeText(entry.deletedAt)}</span></div><button class="icon-button" data-restore-record="${entry.record.id}" title="恢复记录" aria-label="恢复 ${entry.record.date} 记录">${icon('rotate-ccw')}</button></li>`).join('')}</ul>` : '<div class="history-empty"><h2>没有已删除记录</h2></div>'}
      <div class="form-error" id="recycle-error" role="alert"></div></div>`, '已删除记录');
    const error = drawer.querySelector('#recycle-error');
    drawer.onclick = async event => {
      const button = event.target.closest('[data-restore-record]');
      if (!button || button.disabled) return;
      const entry = entries.find(item => item.record.id === button.dataset.restoreRecord);
      button.disabled = true;
      try {
        await store.dispatch({ type: 'restore-record', id: entry.record.id, expected: entry.record });
        if (button.isConnected && !drawer.inert) recycle();
        toast('班次已恢复');
      }
      catch (failure) { error.textContent = failure.message; button.disabled = false; }
    };
  }

  function backup() {
    let pending;
    let expectedRevision;
    let readVersion = 0;
    const drawer = show(`${header('完整备份与恢复', icon)}<div class="drawer-body record-body"><h3 class="record-section-title">完整备份</h3><p class="record-note">包含配置、工作记录、修订历史和已删除记录。</p>
      <div class="backup-status"><p id="backup-last-export" class="record-note">${backupStamp()}</p><p class="record-note">时间仅表示发起导出，请确认下载文件已妥善保存。</p></div>
      <div class="config-actions"><button class="outline-button" id="export-backup">${icon('download')} 导出完整备份</button><button class="outline-button" id="import-backup">${icon('upload')} 选择备份</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div>
      <h3 class="record-section-title">恢复前快照</h3><p class="record-note">最近一次恢复之前的数据单独保留，不受日常保存影响。</p>
      <button class="outline-button" id="load-recovery">${icon('rotate-ccw')} 核对恢复前数据</button>
      <div id="backup-preview" aria-live="polite"></div><div class="form-error" id="backup-error" role="alert"></div></div>
      <div class="drawer-footer"><span class="record-note">恢复会替换当前数据，不合并记录</span><button class="save-button" id="restore-backup" disabled>${icon('check')} 确认恢复</button></div>`, '完整备份与恢复');
    const error = drawer.querySelector('#backup-error');
    const restore = drawer.querySelector('#restore-backup');
    drawer.querySelector('#export-backup').onclick = () => {
      try {
        download(`Paydrop-backup-${dateKey(new Date())}.json`, JSON.stringify(backupEnvelope(store.data), null, 2));
        try { localStorage.setItem(backupStampKey, String(Date.now())); } catch {}
        const stamp = drawer.querySelector('#backup-last-export');
        if (stamp) stamp.textContent = backupStamp();
        toast('已发起完整备份下载，请确认文件已保存');
      } catch (failure) { error.textContent = failure.message || '备份导出失败，请重试'; }
    };
    function preview(input) {
      const imported = readBackup(input, normalizeData);
      pending = input; expectedRevision = store.data.revision;
      const active = activeRecord(imported.records);
      drawer.querySelector('#backup-preview').innerHTML = `<h3 class="record-section-title">恢复预览</h3>
        <table class="record-comparison"><thead><tr><th>项目</th><th>当前</th><th>备份</th></tr></thead><tbody>
        <tr><th>工作记录</th><td>${store.data.records.length}</td><td>${imported.records.length}</td></tr>
        <tr><th>已删除记录</th><td>${store.data.archivedRecords.length}</td><td>${imported.archivedRecords.length}</td></tr>
        <tr><th>日薪（元）</th><td>${currency(Number(store.data.settings.dailySalary))}</td><td>${currency(Number(imported.settings.dailySalary))}</td></tr></tbody></table>
        <p class="record-note">导出于 ${escape(input.exportedAt)}</p>
        ${activeRecord(store.data.records) ? '<p class="record-warning">当前有进行中的班次。请先核对并结束，再重新预览。</p>' : ''}
        ${active ? `<p class="record-warning">备份含 ${active.date} 的进行中班次。恢复后将继续累计，包含备份后经过的时间。</p><label class="record-check"><input type="checkbox" id="resume-imported">我确认继续此班次</label>` : ''}
        <label class="record-check"><input type="checkbox" id="confirm-replace">我确认用备份替换当前配置与全部记录</label>`;
      const checks = [...drawer.querySelectorAll('#backup-preview input')];
      const update = () => { restore.disabled = Boolean(activeRecord(store.data.records)) || !checks.every(check => check.checked); };
      checks.forEach(check => { check.onchange = update; }); update(); error.textContent = '';
    }
    function clearPreview() { pending = null; restore.disabled = true; drawer.querySelector('#backup-preview').innerHTML = ''; }
    function beginRead() { clearPreview(); error.textContent = ''; return ++readVersion; }
    function ownsRead(version) { return version === readVersion && error.isConnected && !drawer.inert; }
    drawer.querySelector('#import-backup').onclick = () => drawer.querySelector('#backup-file').click();
    drawer.querySelector('#backup-file').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      event.target.value = '';
      const version = beginRead();
      try {
        if (file.size > 16 * 1024 * 1024) throw new Error('完整备份须小于 16 MB。');
        let parsed;
        try { parsed = JSON.parse(await file.text()); } catch { throw new Error('备份不是有效 JSON。'); }
        if (!ownsRead(version)) return;
        preview(parsed);
      } catch (failure) { if (ownsRead(version)) error.textContent = failure.message; }
    };
    drawer.querySelector('#load-recovery').onclick = async () => {
      const version = beginRead();
      try {
        const data = await store.readRestoreBackup();
        if (!data) throw new Error('还没有恢复前快照。');
        if (!ownsRead(version)) return;
        preview(backupEnvelope(data));
      } catch (failure) { if (ownsRead(version)) error.textContent = failure.message; }
    };
    restore.onclick = async () => {
      if (!pending || restore.disabled) return;
      restore.disabled = true;
      try {
        await store.dispatch({ type: 'restore-backup', backup: pending, expectedRevision, resumeActive: drawer.querySelector('#resume-imported')?.checked === true });
        if (restore.isConnected && !drawer.inert) close();
        toast('完整备份已恢复；恢复前的数据已单独保留');
      } catch (failure) { error.textContent = failure.message; }
    };
  }
  return { detail, editor, recycle, backup };
}
