const { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');
const { createUpdateService } = require('./updater.cjs');
const { createDataStore } = require('./data-store.cjs');
const { fitBounds } = require('./window-state.cjs');
const { createPetService } = require('./pet-window.cjs');

if (!app.isPackaged && process.env.PAYDROP_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.PAYDROP_TEST_USER_DATA));
}

let widgetWindow, dashboardWindow, tray, dataStore, petService;
let quitting = false;
let moveTimer;
let reviewRecordId = null;
let widgetHeight;
const windowIcon = path.join(__dirname, 'paydrop.ico');
const windows = () => [widgetWindow, dashboardWindow, petService?.getWindow()].filter(window => window && !window.isDestroyed());
const logPath = () => path.join(app.getPath('userData'), 'updates.log');
function log(message) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const file = logPath();
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.previous`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

function showWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  if (widgetWindow.isMinimized()) widgetWindow.restore();
  widgetWindow.show();
  widgetWindow.focus();
}

function refreshTray() {
  if (!tray || !dataStore) return;
  const settings = dataStore.read().data.settings;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示挂件', click: showWidget },
    { label: '工作台与设置', click: openDashboard },
    { label: '小八桌宠', type: 'checkbox', checked: settings.petEnabled, click: item => dataStore.update({ type: 'settings', patch: { petEnabled: item.checked } }) },
    { label: '始终置顶', type: 'checkbox', checked: settings.alwaysOnTop, click: item => dataStore.update({ type: 'settings', patch: { alwaysOnTop: item.checked } }) },
    { type: 'separator' },
    { label: '退出薪动', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyWindowSettings() {
  petService?.sync();
  if (!widgetWindow || !dataStore) return;
  const settings = dataStore.read().data.settings;
  const scale = settings.widgetScale / 100;
  const width = Math.round(380 * scale), height = Math.round(widgetHeight(settings) * scale);
  widgetWindow.setMinimumSize(1, 1);
  widgetWindow.setMaximumSize(1000, 1000);
  const bounds = widgetWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  widgetWindow.setBounds(fitBounds({ ...bounds, width, height }, area));
  widgetWindow.setMinimumSize(width, height);
  widgetWindow.setMaximumSize(width, height);
  widgetWindow.webContents.setZoomFactor(scale);
  widgetWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  refreshTray();
}

function createWidget() {
  const area = screen.getPrimaryDisplay().workArea;
  let position = { x: area.x + area.width - 410, y: area.y + 30 };
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window.json'), 'utf8'));
    const visible = screen.getAllDisplays().some(display => {
      const a = display.workArea;
      return Number.isInteger(saved.x) && Number.isInteger(saved.y) && saved.x >= a.x && saved.y >= a.y && saved.x + 380 <= a.x + a.width && saved.y + 304 <= a.y + a.height;
    });
    if (visible) position = saved;
  } catch {}
  widgetWindow = new BrowserWindow({
    width: 380,
    height: 304,
    x: position.x,
    y: position.y,
    minWidth: 380,
    minHeight: 304,
    maxWidth: 380,
    maxHeight: 304,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    icon: windowIcon,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  widgetWindow.loadFile(path.join(__dirname, '..', 'dist', 'widget.html'));
  widgetWindow.once('ready-to-show', () => { applyWindowSettings(); widgetWindow.show(); });
  widgetWindow.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!widgetWindow || widgetWindow.isDestroyed()) return;
      try {
        const { x, y } = widgetWindow.getBounds();
        const file = path.join(app.getPath('userData'), 'window.json');
        fs.writeFileSync(`${file}.tmp`, JSON.stringify({ x, y }), 'utf8');
        fs.renameSync(`${file}.tmp`, file);
      } catch (error) { log(`Window position: ${error.message}`); }
    }, 250);
  });
  widgetWindow.on('close', event => {
    if (!quitting && dataStore.read().data.settings.closeToTray) {
      event.preventDefault();
      widgetWindow.hide();
    } else if (!quitting) { quitting = true; app.quit(); }
  });
  widgetWindow.on('closed', () => { widgetWindow = null; });
}

function openDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }
  dashboardWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 660,
    title: '薪动 · 薪资与作息',
    icon: windowIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  dashboardWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  dashboardWindow.on('closed', () => { dashboardWindow = null; reviewRecordId = null; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWidget);
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(async () => {
    const model = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'data-model.js')).href);
    ({ widgetHeight } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'widget-sizing.js')).href));
    dataStore = createDataStore({
      directory: app.getPath('userData'), normalizeData: model.normalizeData, applyOperation: model.applyOperation,
      onChange: data => {
        for (const window of windows()) window.webContents.send('data:changed', data);
        applyWindowSettings();
      },
    });
    ipcMain.handle('data:read', () => dataStore.read());
    ipcMain.handle('data:restore-backup', () => dataStore.readRestoreBackup());
    ipcMain.handle('data:update', (_event, operation) => dataStore.update(operation));
    ipcMain.on('widget:open-dashboard', openDashboard);
    ipcMain.on('widget:review-record', (_event, id) => {
      if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || !dataStore.read().data.records.some(record => record.id === id)) return;
      reviewRecordId = id;
      openDashboard();
      // A newly opened renderer consumes the pending request after installing its listener.
      dashboardWindow.webContents.send('dashboard:review-record');
    });
    ipcMain.handle('dashboard:take-review-record', event => {
      if (event.sender !== dashboardWindow?.webContents) return null;
      const id = reviewRecordId;
      reviewRecordId = null;
      return id;
    });
    ipcMain.on('dashboard:show-widget', () => { dashboardWindow?.close(); showWidget(); });
    ipcMain.on('pet:reveal-widget', showWidget);
    ipcMain.on('widget:minimize', () => widgetWindow?.hide());
    ipcMain.on('widget:close', () => widgetWindow?.close());
    ipcMain.handle('update:open-log', async () => {
      if (!fs.existsSync(logPath())) log('No update checks recorded yet.');
      return shell.openPath(logPath());
    });
    createUpdateService({ app, ipcMain, updater: autoUpdater, windows, log });
    petService = createPetService({
      app, BrowserWindow, ipcMain, screen, icon: windowIcon, log,
      getSettings: () => dataStore.read().data.settings,
      updateSettings: patch => dataStore.update({ type: 'settings', patch }),
    });
    petService.sync();
    tray = new Tray(windowIcon);
    tray.setToolTip('薪动 Paydrop');
    tray.on('double-click', showWidget);
    tray.on('click', showWidget);
    refreshTray();
    createWidget();
    setInterval(() => dataStore.update({ type: 'advance' }), 1000).unref();
  }).catch(error => { log(`Startup failed: ${error.stack || error.message}`); app.quit(); });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
