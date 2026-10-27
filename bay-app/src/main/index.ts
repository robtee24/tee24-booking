import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell, powerSaveBlocker } from 'electron';
import log from 'electron-log';
import * as api from './api';
import * as exportsMod from './exports';
import { ApiError } from './api';
import { getSettings, updateSettings, clearRegistration, defaultLaunchMonitorPath, migrateSettings } from './store';
import { launchPlay, launchHelperOnly, pathsExist, startWatching } from './launcher';
import * as poller from './poller';
import * as remote from './remote';
import * as windows from './windows';
import * as autostart from './autostart';
import * as screenWatch from './screen';
import { runStartupUpdate, checkForUpdatesNow } from './updater';

log.initialize();
log.transports.file.level = 'info';
Object.assign(console, log.functions);

// ---------- Single instance + autostart ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    poller.setHomeForced(true);
    windows.get('home')?.focus();
  });
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.disableHardwareAcceleration(); // transparent overlays behave better on bay PCs with mixed GPUs

let autostartBusy: Promise<void> | null = null;

/**
 * Windows: a per-user logon task (immediate) with the HKCU Run entry as the
 * fallback only if the task cannot be registered. Other platforms: Run entry.
 */
function applyAutostart() {
  if (!app.isPackaged) return;
  const { openAtLogin, autostartTaskExe } = getSettings();
  const exe = process.execPath;
  const runEntry = (on: boolean) => app.setLoginItemSettings({ openAtLogin: on, path: exe, args: ['--autostart'] });

  if (process.platform !== 'win32') {
    runEntry(openAtLogin);
    return;
  }
  if (autostartBusy) return;

  autostartBusy = (async () => {
    try {
      if (openAtLogin) {
        // Re-register only when the exe moved (or never registered); each call costs a PowerShell spawn.
        if (autostartTaskExe !== exe || !(await autostart.logonTaskExists())) {
          await autostart.registerLogonTask(exe);
          updateSettings({ autostartTaskExe: exe });
          autostart.logAutostart(`logon task registered for ${exe}`);
        }
        runEntry(false);
      } else {
        await autostart.unregisterLogonTask();
        if (autostartTaskExe) updateSettings({ autostartTaskExe: null });
        runEntry(false);
      }
    } catch (e) {
      // Task Scheduler blocked (policy, service stopped): keep the Run entry so the kiosk still starts.
      log.warn('[autostart] logon task failed; falling back to Run entry', e instanceof Error ? e.message : e);
      runEntry(openAtLogin);
    } finally {
      autostartBusy = null;
    }
  })();
}

// ---------- Admin session (in-memory only) ----------

let adminToken: string | null = null;
let adminSession: Omit<api.AdminSession, 'token'> | null = null;
let adminExpiresAt = 0;
const ADMIN_SESSION_MS = 30 * 60 * 1000; // re-auth after 30 min idle

function requireAdmin(): string {
  if (!adminToken || Date.now() > adminExpiresAt) {
    adminToken = null;
    adminSession = null;
    throw new Error('Admin sign-in required');
  }
  adminExpiresAt = Date.now() + ADMIN_SESSION_MS;
  return adminToken;
}

function toIpcError(e: unknown) {
  if (e instanceof ApiError) return { error: e.message, status: e.status, code: e.code, data: e.data };
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Wrap an IPC handler so renderer gets `{ error }` instead of an opaque throw. */
function handle(channel: string, fn: (...args: any[]) => Promise<unknown> | unknown) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      log.warn(`[ipc] ${channel}`, e instanceof Error ? e.message : e);
      return toIpcError(e);
    }
  });
}

function progress(msg: string) {
  windows.broadcast('admin:progress', msg);
}

// ---------- IPC ----------

function registerIpc() {
  handle('kiosk:getState', () => poller.getState());
  handle('kiosk:play', () => {
    poller.setHomeForced(false);
    const st = launchPlay();
    poller.forcePublish();
    return st;
  });
  handle('kiosk:overlay', (mode: 'help' | 'schedule' | 'export' | 'none') => poller.setUserMode(mode));
  handle('kiosk:acceptUpcoming', (id: string) => poller.acceptUpcoming(id));
  handle('kiosk:checkIn', async (bookingId: string, phone: string) => {
    const r = await api.checkIn(bookingId, phone);
    poller.afterCheckIn();
    return r;
  });
  handle('kiosk:schedule', (dateISO?: string) => api.getSchedule(dateISO));
  handle('kiosk:help', () => api.getHelp());
  handle('kiosk:findExports', () => exportsMod.findRecentCsvs());
  handle('kiosk:sendExports', (input: Parameters<typeof exportsMod.sendExports>[0]) => exportsMod.sendExports(input));
  // Too-many-players modal
  handle('kiosk:playersProceed', () => poller.playersProceed());
  handle('kiosk:playersAddMember', (phone: string) => poller.playersAddMember(phone));
  handle('kiosk:playersSnooze', () => poller.playersSnooze());
  handle('kiosk:playersDismiss', () => poller.playersDismiss());
  handle('kiosk:playersExitGame', () => poller.playersExitGame());

  // ---- Admin ----
  handle('admin:sendOtp', (phone: string) => api.adminSendOtp(phone));
  handle('admin:verifyOtp', async (phone: string, code: string) => {
    const r = await api.adminVerifyOtp(phone, code);
    adminToken = r.token;
    adminExpiresAt = Date.now() + ADMIN_SESSION_MS;
    adminSession = { ok: true, admin: r.admin, locations: r.locations };
    return adminSession;
  });
  handle('admin:session', async () => {
    if (!adminToken || Date.now() > adminExpiresAt) return null;
    try {
      const r = await api.adminRefresh(adminToken);
      adminSession = { ok: true, admin: r.admin, locations: r.locations };
      adminExpiresAt = Date.now() + ADMIN_SESSION_MS;
      return adminSession;
    } catch {
      adminToken = null;
      adminSession = null;
      return null;
    }
  });
  handle('admin:signOut', () => {
    adminToken = null;
    adminSession = null;
    return { ok: true };
  });
  handle('admin:register', async (locationId: string, bayNumber: number, force: boolean) => {
    const token = requireAdmin();
    const r = await api.adminRegister(token, { locationId, bayNumber, force });
    const lm = r.bay?.launchMonitor ?? null;
    const s = getSettings();
    updateSettings({
      locationId: r.location.id,
      locationName: r.location.name,
      locationSlug: r.location.slug,
      bayId: r.bay?.id ?? null,
      bayNumber: r.registration.bayNumber,
      bayName: r.bay?.name ?? null,
      launchMonitor: lm,
      launchMonitorPath: s.launchMonitorPath || defaultLaunchMonitorPath(lm),
      setupCompletedAt: new Date().toISOString(),
    });
    poller.pollNow();
    return r;
  });
  handle('admin:unregister', async () => {
    const token = requireAdmin();
    await api.adminUnregister(token).catch((e) => {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    });
    clearRegistration();
    poller.pollNow();
    return { ok: true };
  });
  handle('admin:patchBay', async (patch: { name?: string | null; launchMonitor?: string; setupNotes?: string | null }) => {
    const token = requireAdmin();
    const r = await api.adminPatchBaySettings(token, patch);
    updateSettings({ bayName: r.bay.name, launchMonitor: r.bay.launchMonitor });
    poller.pollNow();
    return r;
  });
  handle('admin:saveLocal', (patch: Record<string, unknown>) => {
    requireAdmin();
    const allowed = ['apiBaseUrl', 'launchMonitorPath', 'gsproPath', 'openAtLogin', 'idleCloseMinutes'] as const;
    const clean: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ('idleCloseMinutes' in clean) {
      const n = Number(clean.idleCloseMinutes);
      clean.idleCloseMinutes = Number.isFinite(n) && n >= 0 ? Math.min(240, Math.round(n)) : 10;
    }
    const s = updateSettings(clean);
    applyAutostart();
    poller.forcePublish();
    return s;
  });
  handle('admin:browseExe', async (title: string) => {
    requireAdmin();
    const win = windows.get('home') ?? BrowserWindow.getFocusedWindow() ?? undefined;
    const r = await dialog.showOpenDialog(win as BrowserWindow, {
      title,
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('admin:launch', (which: 'launchMonitor' | 'gspro') => {
    requireAdmin();
    return launchHelperOnly(which);
  });
  handle('admin:pathsExist', () => pathsExist());
  handle('admin:screenTest', () => screenWatch.scanOnce());
  handle('admin:remoteStatus', () => remote.getRemoteAgentStatus());
  handle('admin:remoteInstall', async () => {
    requireAdmin();
    const r = await remote.installAgent(progress);
    poller.pollNow(); // reports node id to the server
    return r;
  });
  handle('admin:remoteUninstall', async () => {
    requireAdmin();
    return remote.uninstallAgent();
  });
  handle('admin:checkUpdates', async () => {
    requireAdmin();
    return checkForUpdatesNow((p) => windows.broadcast('kiosk:update', p));
  });
  handle('admin:restart', () => {
    requireAdmin();
    app.relaunch();
    app.exit(0);
  });
  handle('admin:quit', () => {
    requireAdmin();
    app.exit(0);
  });
  handle('admin:openExternal', (url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return { error: 'Blocked' };
  });
}

// ---------- Boot ----------

app.whenReady().then(async () => {
  const migrated = migrateSettings();
  if (migrated) log.info(`[store] migrated: ${migrated}`);
  applyAutostart();
  powerSaveBlocker.start('prevent-display-sleep');
  registerIpc();

  // Home window doubles as the update splash: it renders the "Updating…" screen
  // until the updater resolves, then the real home screen.
  const home = windows.createHome();
  const sendUpdate = (p: unknown) => {
    if (!home.isDestroyed()) home.webContents.send('kiosk:update', p);
  };
  await new Promise<void>((resolve) => {
    if (home.webContents.isLoading()) home.webContents.once('did-finish-load', () => resolve());
    else resolve();
  });

  const result = await runStartupUpdate(sendUpdate);
  if (result === 'updated') return; // quitAndInstall will relaunch us
  sendUpdate({ phase: 'done', version: app.getVersion() });

  poller.start();
  startWatching(); // GSPro presence → home hides / toolbar shows, however GSPro was started

  // Staff: bring the kiosk home screen over GSPro
  globalShortcut.register('CommandOrControl+Shift+T', () => poller.setHomeForced(true));
});

app.on('window-all-closed', () => {
  // Kiosk stays alive even if a window closes (default would quit on Windows).
});

app.on('will-quit', () => globalShortcut.unregisterAll());
