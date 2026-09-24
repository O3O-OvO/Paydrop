const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');
const { createUpdateService } = require('./updater.cjs');

let widgetWindow;
let dashboardWindow;
const windowIcon = path.join(__dirname, 'paydrop.ico');
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return null; } }
function writeSettings(settings) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings), 'utf8');
  widgetWindow?.webContents.send('widget:refresh-settings');
}

function createWidget() {
  const area = screen.getPrimaryDisplay().workArea;
  widgetWindow = new BrowserWindow({
    width: 380,
    height: 304,
    x: Math.max(area.x, area.x + area.width - 410),
    y: Math.max(area.y, area.y + 30),
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
  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  widgetWindow.loadFile(path.join(__dirname, '..', 'dist', 'widget.html'));
  widgetWindow.once('ready-to-show', () => widgetWindow.show());
  widgetWindow.on('closed', () => { widgetWindow = null; app.quit(); });
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
  dashboardWindow.on('closed', () => { dashboardWindow = null; });
}

app.whenReady().then(() => {
  ipcMain.on('widget:open-dashboard', openDashboard);
  ipcMain.on('dashboard:show-widget', () => {
    dashboardWindow?.close();
    if (widgetWindow?.isMinimized()) widgetWindow.restore();
    widgetWindow?.show();
    widgetWindow?.focus();
  });
  ipcMain.on('widget:minimize', () => widgetWindow?.minimize());
  ipcMain.on('widget:close', () => app.quit());
  ipcMain.on('settings:read', (event) => { event.returnValue = readSettings(); });
  ipcMain.on('settings:write', (event, settings) => { writeSettings(settings); event.returnValue = true; });
  createUpdateService({
    app, ipcMain, updater: autoUpdater,
    windows: () => [widgetWindow, dashboardWindow],
  });
  createWidget();
});

app.on('window-all-closed', () => app.quit());
