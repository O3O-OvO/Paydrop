const fs = require('node:fs');
const path = require('node:path');
const { fitBounds } = require('./window-state.cjs');

function nextWalkPosition(x, direction, distance, area, width) {
  const maximum = Math.max(area.x, area.x + area.width - width);
  const next = x + direction * Math.max(0, distance);
  if (next >= maximum) return { x: maximum, direction: -1 };
  if (next <= area.x) return { x: area.x, direction: 1 };
  return { x: next, direction };
}

function createPetService({ app, BrowserWindow, ipcMain, screen, getSettings, updateSettings, icon, log }) {
  let window, signature = '', walking = false, dragging = null;
  let direction = 1, walkX = null, previousTime = Date.now(), saveTimer;
  const file = path.join(app.getPath('userData'), 'pet-window.json');
  const alive = () => window && !window.isDestroyed();
  function save() {
    if (!alive()) return;
    try {
      const { x, y } = window.getBounds();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ x, y }), 'utf8');
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) { log(`Pet position: ${error.message}`); }
  }
  function setEnabled(enabled) {
    const result = updateSettings({ petEnabled: enabled });
    if (!result.ok) log(`Pet preference: ${result.error}`);
    return result;
  }
  function create() {
    const area = screen.getPrimaryDisplay().workArea;
    let position = { x: area.x + area.width - 340, y: area.y + area.height - 290 };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) position = saved;
    } catch {}
    const display = screen.getDisplayNearestPoint(position).workArea;
    const bounds = fitBounds({ ...position, width: 300, height: 280 }, display);
    window = new BrowserWindow({
      ...bounds, title: '小八桌宠 · Paydrop', frame: false, transparent: true,
      backgroundColor: '#00000000', icon, resizable: false, skipTaskbar: true,
      hasShadow: false, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    window.loadFile(path.join(__dirname, '..', 'dist', 'pet.html'));
    window.once('ready-to-show', () => {
      if (!alive() || !getSettings().petEnabled) return;
      window.setIgnoreMouseEvents(true, { forward: true });
      window.showInactive();
    });
    window.on('move', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 600);
    });
    window.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      setEnabled(false);
    });
    window.on('closed', () => { window = null; signature = ''; walking = false; dragging = null; });
  }
  function sync() {
    const settings = getSettings();
    if (!settings.petEnabled) {
      walking = false; dragging = null;
      if (alive() && window.isVisible()) { save(); window.hide(); }
      return;
    }
    if (!alive()) create();
    const nextSignature = `${settings.petScale}|${settings.alwaysOnTop}`;
    if (signature !== nextSignature) {
      signature = nextSignature;
      const scale = settings.petScale / 100, bounds = window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      window.setBounds(fitBounds({ ...bounds, width: Math.round(300 * scale), height: Math.round(280 * scale) }, area));
      window.webContents.setZoomFactor(scale);
      window.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
      walkX = null;
    }
    if (!window.isVisible() && !window.webContents.isLoading()) window.showInactive();
    if (!settings.petRoam || !settings.motion) walking = false;
  }
  function owned(event) { return alive() && event.sender.id === window.webContents.id; }
  ipcMain.on('pet:show', () => {
    const result = setEnabled(true);
    if (result.ok) sync();
  });
  ipcMain.on('pet:hide', event => { if (owned(event)) setEnabled(false); });
  ipcMain.on('pet:activity', (event, value) => {
    if (!owned(event) || !['walk', 'idle'].includes(value)) return;
    const settings = getSettings();
    walking = value === 'walk' && settings.petEnabled && settings.petRoam && settings.motion;
    walkX = null;
    if (!walking) save();
  });
  ipcMain.on('pet:passthrough', (event, value) => {
    if (!owned(event) || typeof value !== 'boolean') return;
    window.setIgnoreMouseEvents(dragging ? false : value, { forward: true });
  });
  ipcMain.on('pet:drag', (event, phase) => {
    if (!owned(event)) return;
    if (phase === 'start') {
      const cursor = screen.getCursorScreenPoint(), bounds = window.getBounds();
      dragging = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
      walking = false; walkX = null; window.setIgnoreMouseEvents(false);
    } else if (phase === 'end') { dragging = null; save(); }
  });
  const timer = setInterval(() => {
    const now = Date.now(), elapsed = Math.min(100, Math.max(0, now - previousTime));
    previousTime = now;
    if (!alive() || !window.isVisible()) return;
    if (dragging) {
      const cursor = screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const next = fitBounds({ ...window.getBounds(), x: cursor.x - dragging.x, y: cursor.y - dragging.y }, area);
      window.setPosition(Math.round(next.x), Math.round(next.y));
    } else if (walking) {
      const bounds = window.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
      const next = nextWalkPosition(walkX ?? bounds.x, direction, elapsed * .045, area, bounds.width);
      walkX = next.x;
      window.setPosition(Math.round(next.x), bounds.y);
      if (direction !== next.direction) {
        direction = next.direction;
        window.webContents.send('pet:direction', direction);
      }
    }
  }, 32);
  timer.unref();
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true; clearInterval(timer); clearTimeout(saveTimer); save();
  });
  return { sync, getWindow: () => alive() ? window : null };
}

module.exports = { createPetService, nextWalkPosition };
