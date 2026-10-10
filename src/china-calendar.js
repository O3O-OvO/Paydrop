// Versioned official arrangements: never edit a published edition in place.
export const CHINA_CALENDAR = 'cn-2025-2026-v1';
export const CALENDAR_YEARS = [2025, 2026];
export const CALENDAR_SOURCES = {
  2025: { title: '国办发明电〔2024〕12号', published: '2024-11-12', url: 'https://big5.www.gov.cn/gate/big5/www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm' },
  2026: { title: '国办发明电〔2025〕7号', published: '2025-11-04', url: 'https://big5.www.gov.cn/gate/big5/www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm' },
};
const arrangements = [
  ['2025-01-01', '2025-01-01', '元旦', []],
  ['2025-01-28', '2025-02-04', '春节', ['2025-01-26', '2025-02-08']],
  ['2025-04-04', '2025-04-06', '清明节', []],
  ['2025-05-01', '2025-05-05', '劳动节', ['2025-04-27']],
  ['2025-05-31', '2025-06-02', '端午节', []],
  ['2025-10-01', '2025-10-08', '国庆中秋', ['2025-09-28', '2025-10-11']],
  ['2026-01-01', '2026-01-03', '元旦', ['2026-01-04']],
  ['2026-02-15', '2026-02-23', '春节', ['2026-02-14', '2026-02-28']],
  ['2026-04-04', '2026-04-06', '清明节', []],
  ['2026-05-01', '2026-05-05', '劳动节', ['2026-05-09']],
  ['2026-06-19', '2026-06-21', '端午节', []],
  ['2026-09-25', '2026-09-27', '中秋节', []],
  ['2026-10-01', '2026-10-07', '国庆节', ['2026-09-20', '2026-10-10']],
];
const days = new Map();
for (const [start, end, name, workdays] of arrangements) {
  // UTC is used only to expand date-only keys, never to determine a user's shift.
  for (let date = Date.parse(`${start}T00:00:00Z`); date <= Date.parse(`${end}T00:00:00Z`); date += 86400000) {
    days.set(new Date(date).toISOString().slice(0, 10), { name, working: false });
  }
  workdays.forEach(date => days.set(date, { name, working: true }));
}
export function officialDay(key) {
  const entry = days.get(key);
  return { covered: CALENDAR_YEARS.includes(Number(key.slice(0, 4))), ...(entry || {}) };
}
export function calendarName(value) {
  return value === CHINA_CALENDAR ? '中国大陆节假日与调休（2025–2026）' : '每周作息';
}
export function resolveWorkday(settings, key) {
  const official = officialDay(key);
  const exception = settings.exceptions?.find(item => item.date === key);
  const enabled = settings.workCalendar === CHINA_CALENDAR;
  if (exception) return { working: exception.working, source: 'manual', label: `手动${exception.working ? '工作' : '休息'}`, official };
  if (enabled && official.name) return { working: official.working, source: 'official', label: `${official.name}${official.working ? '补班' : '放假'}`, official };
  const weekday = new Date(`${key}T12:00:00`).getDay();
  const working = !settings.workdays || settings.workdays.includes(weekday);
  return { working, source: enabled && !official.covered ? 'fallback' : 'weekly', label: working ? '常规工作日' : '常规休息日', official };
}

const lunarDays = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
let lunarFormatter;
try { lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' }); } catch {}
export function lunarDate(key) {
  if (!lunarFormatter || lunarFormatter.resolvedOptions().calendar !== 'chinese') return '';
  const parts = lunarFormatter.formatToParts(new Date(`${key}T12:00:00`));
  const month = parts.find(part => part.type === 'month')?.value || '';
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return day === 1 ? month : lunarDays[day - 1] || '';
}
