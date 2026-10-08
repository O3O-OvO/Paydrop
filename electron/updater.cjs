const fs = require('node:fs');
const path = require('node:path');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createUpdateService({ app, ipcMain, updater, windows, scheduler = globalThis, enabled, log = () => {} }) {
  const available = enabled ?? (
    app.isPackaged &&
    !process.env.PORTABLE_EXECUTABLE_FILE &&
    fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
  );
  let state = { phase: available ? 'idle' : 'unavailable', currentVersion: app.getVersion() };
  let checking = false;
  function fail(error) {
    const raw = String(error?.code || error?.message || error || 'UNKNOWN');
    const code = error?.code || 'UPDATE_ERROR';
    const message = /404|CHANNEL_FILE|LATEST_VERSION|NO_PUBLISHED/.test(raw) ? '更新源或发布文件不存在，请检查安装版本和发布配置。'
      : /ENOTFOUND|ECONN|ETIMEDOUT|ERR_NETWORK|net::/.test(raw) ? '无法连接更新服务器，请检查网络或代理后重试。'
      : /SHA|CHECKSUM|SIGNATURE|signature/i.test(raw) ? '更新包校验失败，未安装，请重新下载。'
      : '更新失败，请重试或查看诊断日志。';
    log(`Update error [${code}]: ${error?.message || raw}`);
    setState('error', { errorCode: String(code), errorMessage: message });
  }

  function setState(phase, details = {}) {
    state = { ...state, ...details, phase };
    for (const window of windows()) {
      if (window && !window.isDestroyed()) window.webContents.send('update:status', state);
    }
    return state;
  }

  async function check() {
    if (!available || checking || ['downloading', 'ready', 'installing'].includes(state.phase)) return state;
    checking = true;
    log(`Checking updates: installed=${app.getVersion()}`);
    setState('checking', { errorCode: undefined, errorMessage: undefined, checkedAt: new Date().toISOString() });
    try {
      await updater.checkForUpdates();
    } catch (error) {
      fail(error);
    } finally {
      checking = false;
    }
    return state;
  }

  ipcMain.handle('update:get-state', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => {
    if (state.phase !== 'ready') return false;
    setState('installing');
    scheduler.setTimeout(() => updater.quitAndInstall(false, true), 0);
    return true;
  });

  if (available) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => setState('checking'));
    updater.on('update-available', info => setState('downloading', { availableVersion: info.version, percent: 0 }));
    updater.on('download-progress', progress => setState('downloading', { percent: Math.round(progress.percent) }));
    updater.on('update-downloaded', info => setState('ready', { availableVersion: info.version, percent: 100 }));
    updater.on('update-not-available', () => setState('current', { availableVersion: undefined, percent: undefined }));
    updater.on('error', fail);
    scheduler.setTimeout(() => { void check(); }, 15_000).unref?.();
    scheduler.setInterval(() => { void check(); }, CHECK_INTERVAL_MS).unref?.();
  }

  return { check, getState: () => state };
}

module.exports = { createUpdateService };
