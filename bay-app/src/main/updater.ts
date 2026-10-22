import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import log from 'electron-log';

export type UpdatePhase =
  | { phase: 'checking' }
  | { phase: 'none'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string };

type Listener = (p: UpdatePhase) => void;

/**
 * Auto-update on every launch.
 *
 * Flow: checking → (none | downloading → installing → quitAndInstall).
 * The splash window shows progress; the kiosk never reaches the home screen on
 * an outdated build unless the update server is unreachable (then we continue,
 * so a network blip never bricks a bay).
 */
export async function runStartupUpdate(onPhase: Listener, { timeoutMs = 45_000 } = {}): Promise<'updated' | 'current' | 'skipped'> {
  if (!app.isPackaged) {
    onPhase({ phase: 'none', version: app.getVersion() });
    return 'skipped';
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: 'updated' | 'current' | 'skipped') => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      autoUpdater.removeAllListeners();
      resolve(r);
    };

    // Never hang startup on a slow/offline network.
    const watchdog = setTimeout(() => {
      log.warn('[updater] timed out; continuing with current version');
      onPhase({ phase: 'none', version: app.getVersion() });
      finish('skipped');
    }, timeoutMs);

    autoUpdater.on('checking-for-update', () => onPhase({ phase: 'checking' }));
    autoUpdater.on('update-not-available', () => {
      onPhase({ phase: 'none', version: app.getVersion() });
      finish('current');
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info(`[updater] update available ${info.version}`);
      // Downloading: stop the watchdog, give the download as long as it needs.
      clearTimeout(watchdog);
      onPhase({ phase: 'downloading', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (p) => {
      onPhase({ phase: 'downloading', version: '', percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info(`[updater] downloaded ${info.version}; installing`);
      onPhase({ phase: 'installing', version: info.version });
      setTimeout(() => {
        settled = true;
        // isSilent=true, isForceRunAfter=true → installs quietly and relaunches.
        autoUpdater.quitAndInstall(true, true);
      }, 800);
    });
    autoUpdater.on('error', (err) => {
      log.error('[updater] error', err);
      onPhase({ phase: 'error', message: err?.message ?? String(err) });
      finish('skipped');
    });

    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[updater] checkForUpdates failed', err);
      onPhase({ phase: 'error', message: err?.message ?? String(err) });
      finish('skipped');
    });
  });
}

/** Manual check from the Settings screen (also installs if found). */
export async function checkForUpdatesNow(onPhase: Listener) {
  return runStartupUpdate(onPhase, { timeoutMs: 30_000 });
}
