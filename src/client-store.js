import { applyOperation, normalizeData } from './data-model.js';

const KEY = 'paydrop-data-v3';
let state;
let initialIssue = '';
const listeners = new Set();
const desktop = window.paydropDesktop;

function readWeb() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeData(JSON.parse(raw));
    let saved = JSON.parse(localStorage.getItem('paydrop-settings-v2') || 'null');
    if (!saved) {
      const old = JSON.parse(localStorage.getItem('paydrop-settings-v1') || 'null');
      if (old) saved = { ...old, dailySalary: Number((old.salary / old.workdays).toFixed(2)) };
    }
    return normalizeData(saved ? { settings: saved } : {});
  } catch {
    initialIssue = '配置读取异常，已尝试恢复备份；请检查设置。';
    try { return normalizeData(JSON.parse(localStorage.getItem(`${KEY}-backup`) || '{}')); }
    catch { return normalizeData(); }
  }
}

function accept(next) {
  if (!next || (state && next.revision < state.revision)) return;
  state = next;
  for (const listener of listeners) listener(state);
}

export const store = {
  async init() {
    if (desktop?.readData) {
      desktop.onDataChanged(accept);
      const result = await desktop.readData();
      accept(result.data);
      initialIssue = result.issue || '';
    } else {
      state = readWeb();
      window.addEventListener('storage', event => {
        if (event.key === KEY) accept(readWeb());
      });
    }
    return state;
  },
  get data() { return state; },
  get issue() { return initialIssue; },
  subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  async dispatch(operation) {
    if (desktop?.updateData) {
      const result = await desktop.updateData(operation);
      if (!result.ok) throw new Error(result.error || '保存失败。');
      accept(result.data);
      return state;
    }
    const run = () => {
      const current = readWeb();
      const next = applyOperation(current, operation);
      if (next === current) return state;
      try {
        const previous = localStorage.getItem(KEY);
        if (previous) localStorage.setItem(`${KEY}-backup`, previous);
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch { throw new Error('本地保存失败，请检查浏览器存储空间或权限。'); }
      accept(next);
      return state;
    };
    if (navigator.locks) return navigator.locks.request('paydrop-data', run);
    return run();
  },
};
