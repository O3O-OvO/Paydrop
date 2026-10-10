import { resolveBreaks, scheduleError } from './schedule.js';
import { CHINA_CALENDAR } from './china-calendar.js';

export const defaults = {
  setupComplete: false,
  dailySalary: 545.45, start: '09:00', end: '18:00',
  breaks: [{ start: '12:00', end: '13:00' }],
  workdays: [1, 2, 3, 4, 5], exceptions: [], workCalendar: 'weekly',
  paidOvertime: false, overtimeMultiplier: 1.5, trackingMode: 'estimate',
  overtimeReminderEnabled: true, overtimeReminderHours: 8,
  sound: false, motion: true, theme: 'hachiware',
  backgroundOpacity: 8, widgetOpacity: 100, amountPrecision: 4,
  alwaysOnTop: true, widgetScale: 100, closeToTray: true,
  widgetPetEnabled: true, widgetDensity: 'standard',
  petEnabled: false, petRoam: true, petFollowWork: true,
  petScale: 100, petOpacity: 100,
};

export function settingsError(value) {
  const error = scheduleError(value);
  if (error) return error;
  if ('setupComplete' in value && typeof value.setupComplete !== 'boolean') return '首次配置状态无效。';
  if (value.breaks.length > 100 || value.breaks.some(item => item.paid !== undefined && typeof item.paid !== 'boolean')) return '休息时段数量或计薪类型无效。';
  if (!Array.isArray(value.workdays) || value.workdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(value.workdays).size !== value.workdays.length) return '工作日设置无效。';
  if (!Array.isArray(value.exceptions) || value.exceptions.length > 366 || value.exceptions.some(item => {
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || typeof item.working !== 'boolean') return true;
    const date = new Date(`${item.date}T12:00:00`);
    return !Number.isFinite(date.getTime()) || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` !== item.date;
  }) || new Set(value.exceptions.map(item => item.date)).size !== value.exceptions.length) return '特殊日期无效或重复。';
  if (!['estimate', 'actual'].includes(value.trackingMode)) return '请选择有效的计薪模式。';
  if (!['minimal', 'night', 'hachiware'].includes(value.theme)) return '主题无效。';
  if ('workCalendar' in value && !['weekly', CHINA_CALENDAR].includes(value.workCalendar)) return '工作日历版本无效，请更新软件或选择每周作息。';
  if ('widgetDensity' in value && !['compact', 'standard'].includes(value.widgetDensity)) return '挂件布局无效。';
  if (![2, 4].includes(value.amountPrecision)) return '金额精度只支持 2 位或 4 位。';
  for (const [key, min, max] of [['dailySalary', 0.01, 1000000], ['overtimeMultiplier', 1, 5], ['backgroundOpacity', 0, 100], ['widgetOpacity', 20, 100], ['widgetScale', 80, 150]]) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return `${({ dailySalary: '日薪', overtimeMultiplier: '加班倍率', backgroundOpacity: '背景不透明度', widgetOpacity: '挂件不透明度', widgetScale: '挂件缩放' })[key]}超出有效范围。`;
  }
  for (const key of ['paidOvertime', 'sound', 'motion', 'alwaysOnTop', 'closeToTray']) {
    if (typeof value[key] !== 'boolean') return '开关设置须为布尔值。';
  }
  if ('overtimeReminderEnabled' in value && typeof value.overtimeReminderEnabled !== 'boolean') return '加班提醒开关无效。';
  if ('overtimeReminderHours' in value && (!Number.isInteger(value.overtimeReminderHours) || value.overtimeReminderHours < 1 || value.overtimeReminderHours > 24)) return '加班提醒须为 1 到 24 小时的整数。';
  // Pet preferences are optional in previously saved settings and salary snapshots.
  for (const key of ['petEnabled', 'petRoam', 'petFollowWork', 'widgetPetEnabled']) {
    if (key in value && typeof value[key] !== 'boolean') return '桌宠开关设置无效。';
  }
  for (const [key, min, max] of [['petScale', 70, 140], ['petOpacity', 30, 100]]) {
    if (key in value && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max)) return '桌宠大小或不透明度超出有效范围。';
  }
  return '';
}

export function normalizeSettings(saved = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const value = Object.fromEntries(Object.keys(defaults).map(key => [key, saved[key] ?? structuredClone(defaults[key])]));
  // Existing installations already have a salary; only a genuinely new profile needs setup.
  value.setupComplete = saved.setupComplete ?? Object.hasOwn(saved, 'dailySalary');
  value.breaks = resolveBreaks(saved, defaults.breaks);
  return settingsError(value) ? structuredClone(defaults) : value;
}

export function validatePatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !(key in defaults))) throw new Error('设置字段无效。');
  const value = { ...current, ...patch };
  const error = settingsError(value);
  if (error) throw new Error(error);
  return value;
}
