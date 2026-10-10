export function mountSettingsNavigation(form) {
  const buttons = [...form.querySelectorAll('[data-settings-tab]')];
  const panels = [...form.querySelectorAll('[data-settings-panel]')];
  function select(id, focus = false) {
    buttons.forEach(button => {
      const active = button.dataset.settingsTab === id;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    panels.forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== id; });
  }
  buttons.forEach((button, index) => {
    button.onclick = () => select(button.dataset.settingsTab);
    button.onkeydown = event => {
      const next = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length,
        Home: 0, End: buttons.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(buttons[next].dataset.settingsTab, true);
    };
  });
  // Reveal an invalid field before the browser tries to focus a hidden panel.
  form.addEventListener('invalid', event => {
    const firstInvalid = form.querySelector('input:invalid, select:invalid, textarea:invalid') || event.target;
    const panel = firstInvalid.closest('[data-settings-panel]');
    if (panel) select(panel.dataset.settingsPanel);
  }, true);
  select('pay');
}
