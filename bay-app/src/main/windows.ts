import { BrowserWindow, screen, app } from 'electron';
import path from 'path';

const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL;

type WinName = 'home' | 'toolbar' | 'overlay';

const wins: Partial<Record<WinName, BrowserWindow>> = {};

function preload() {
  return path.join(__dirname, 'preload.js');
}

function loadPage(win: BrowserWindow, page: WinName) {
  if (isDev) return win.loadURL(`${DEV_URL}/${page}.html`);
  return win.loadFile(path.join(__dirname, '..', 'renderer', `${page}.html`));
}

function common(extra: Electron.BrowserWindowConstructorOptions): Electron.BrowserWindowConstructorOptions {
  return {
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
    ...extra,
  };
}

export function get(name: WinName): BrowserWindow | undefined {
  const w = wins[name];
  return w && !w.isDestroyed() ? w : undefined;
}

/** Fullscreen kiosk home (replaces the Golfin Launcher home screen). */
export function createHome(): BrowserWindow {
  const existing = get('home');
  if (existing) return existing;
  const windowed = !!process.env.TEE24_KIOSK_WINDOWED;
  const { width, height } = windowed ? { width: 1280, height: 800 } : screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow(
    common({
      width,
      height,
      x: 0,
      y: 0,
      frame: !!process.env.TEE24_KIOSK_WINDOWED,
      fullscreen: !process.env.TEE24_KIOSK_WINDOWED,
      kiosk: app.isPackaged && !process.env.TEE24_KIOSK_WINDOWED,
      backgroundColor: '#0b1220',
      title: 'Tee24 Bay Kiosk',
    }),
  );
  win.setMenuBarVisibility(false);
  loadPage(win, 'home');
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => delete wins.home);
  wins.home = win;
  return win;
}

/** Narrow always-on-top strip hugging the right edge: Help / Schedule / Export / countdown. */
export function createToolbar(): BrowserWindow {
  const existing = get('toolbar');
  if (existing) return existing;
  const win = new BrowserWindow(
    common({
      width: 92,
      height: 400,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'Tee24 Help',
    }),
  );
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionToolbar(win);
  loadPage(win, 'toolbar');
  win.on('closed', () => delete wins.toolbar);
  wins.toolbar = win;
  return win;
}

export function positionToolbar(win = get('toolbar')) {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  win.setPosition(workArea.x + workArea.width - w - 6, Math.round(workArea.y + workArea.height / 2 - h / 2));
}

/** Transparent fullscreen overlay for the unlock / upcoming / help / schedule modals. */
export function createOverlay(): BrowserWindow {
  const existing = get('overlay');
  if (existing) return existing;
  const { bounds } = screen.getPrimaryDisplay();
  const win = new BrowserWindow(
    common({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'Tee24 Reservation',
    }),
  );
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadPage(win, 'overlay');
  win.on('closed', () => delete wins.overlay);
  wins.overlay = win;
  return win;
}

export function showOverlay() {
  const w = createOverlay();
  if (!w.isVisible()) w.show();
  w.setAlwaysOnTop(true, 'screen-saver');
  w.focus();
}

export function hideOverlay() {
  get('overlay')?.hide();
}

export function showToolbar() {
  const w = createToolbar();
  positionToolbar(w);
  if (!w.isVisible()) w.showInactive();
}

export function hideToolbar() {
  get('toolbar')?.hide();
}

export function showHome() {
  const w = createHome();
  if (!w.isVisible()) w.show();
  w.focus();
}

export function hideHome() {
  get('home')?.hide();
}

/**
 * Keep home visible but *underneath* GSPro while a session runs, so the
 * moment GSPro's window closes the player sees the kiosk, not the desktop.
 *
 * Verified on Windows 11: a hidden window re-shown with showInactive() is
 * placed below the current foreground window. So: drop the (topmost) toolbar
 * for a beat, hide home so GSPro takes foreground, then re-show home inactive
 * and bring the toolbar back. Idempotent; cheap enough to call on each publish.
 */
let parking = false;
export function parkHomeBehind(force = false) {
  const home = get('home');
  if (!home || parking) return;
  if (home.isVisible() && !home.isFocused() && !force) return; // already parked
  parking = true;
  const toolbar = get('toolbar');
  const toolbarWasVisible = !!toolbar?.isVisible();
  toolbar?.hide();
  home.hide();
  setTimeout(() => {
    try {
      const h = get('home');
      if (h && !h.isVisible()) h.showInactive();
      if (toolbarWasVisible) showToolbar();
    } finally {
      parking = false;
    }
  }, 300);
}

export function broadcast(channel: string, payload: unknown) {
  for (const name of ['home', 'toolbar', 'overlay'] as WinName[]) {
    const w = get(name);
    if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
}
