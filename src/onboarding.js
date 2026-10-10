import { CHINA_CALENDAR } from './china-calendar.js';
import { settingsError } from './settings.js';

export function setupPatch(form, settings) {
  const value = {
    dailySalary: Number(form.get('dailySalary')),
    start: form.get('start'), end: form.get('end'),
    workdays: form.getAll('workday').map(Number),
    workCalendar: form.get('workCalendar'),
    trackingMode: form.get('trackingMode'),
    breaks: form.has('hasBreak') ? [{ start: form.get('restStart'), end: form.get('restEnd'), paid: form.has('restPaid') }] : [],
    setupComplete: true,
  };
  if (!['weekly', CHINA_CALENDAR].includes(value.workCalendar)) throw new Error('请选择是否遵循中国节假日与调休。');
  if (!value.workdays.length) throw new Error('请至少选择一个常规工作日，特殊日期可稍后调整。');
  const error = settingsError({ ...settings, ...value });
  if (error) throw new Error(error);
  return value;
}

export function mountOnboarding(host, settings, save, complete) {
  host.innerHTML = `<main class="setup-page">
    <header class="setup-heading"><img src="./hachiware-face.png" alt="" width="56" height="56"><div><span>薪动 PAYDROP</span><h1>确认你的计薪安排</h1></div></header>
    <form id="setup-form">
      <section><h2>薪资与作息</h2>
        <label class="field">日薪（元）<input name="dailySalary" type="number" min="0.01" max="1000000" step="0.01" placeholder="填写你的日薪" required></label>
        <div class="field-grid"><label class="field">上班时间<input name="start" type="time" value="${settings.start}" required></label><label class="field">下班时间<input name="end" type="time" value="${settings.end}" required></label></div>
        <label class="setup-check"><input type="checkbox" name="hasBreak" checked>固定休息时段</label>
        <div id="setup-rest" class="field-grid"><label class="field">休息开始<input name="restStart" type="time" value="12:00" required></label><label class="field">休息结束<input name="restEnd" type="time" value="13:00" required></label><label class="setup-check"><input type="checkbox" name="restPaid">休息计薪</label></div>
      </section>
      <section><h2>工作日历</h2><div class="weekday-picker">${[[1,'一'],[2,'二'],[3,'三'],[4,'四'],[5,'五'],[6,'六'],[0,'日']].map(([day,label]) => `<label><input type="checkbox" name="workday" value="${day}" ${settings.workdays.includes(day) ? 'checked' : ''}><span>周${label}</span></label>`).join('')}</div>
        <label class="field">放假与调休<select name="workCalendar" required><option value="">请选择</option><option value="${CHINA_CALENDAR}">遵循中国大陆节假日与调休（2025–2026）</option><option value="weekly">仅按每周作息</option></select></label>
        <p class="setup-note">未收录年份按每周作息；公司安排可用特殊日期覆盖。</p>
        <fieldset class="setup-modes"><legend>计薪方式</legend><label><input name="trackingMode" type="radio" value="actual" checked><span><strong>实际打卡</strong><small>从打卡时刻计薪，保存工作记录。</small></span></label><label><input name="trackingMode" type="radio" value="estimate"><span><strong>作息估算</strong><small>按计划作息估算，不生成打卡记录。</small></span></label></fieldset>
      </section>
      <footer><p id="setup-error" role="alert"></p><button type="submit" class="save-button">确认并进入工作台</button></footer>
    </form></main>`;
  const form = host.querySelector('form');
  form.elements.hasBreak.onchange = () => {
    const enabled = form.elements.hasBreak.checked;
    host.querySelector('#setup-rest').hidden = !enabled;
    for (const name of ['restStart', 'restEnd', 'restPaid']) form.elements[name].disabled = !enabled;
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const errorHost = host.querySelector('#setup-error');
    const button = form.querySelector('[type="submit"]');
    errorHost.textContent = '';
    try {
      const patch = setupPatch(new FormData(form), settings);
      button.disabled = true;
      await save(patch, settings);
      complete();
    } catch (error) { errorHost.textContent = error.message || '保存失败，请重试。'; }
    finally { if (button.isConnected) button.disabled = false; }
  };
}
