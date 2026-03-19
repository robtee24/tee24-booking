import { BrowserWindow, screen } from 'electron';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const preloadPath = path.join(__dirname, 'preload.js');

function rendererUrl(page: string): string {
  if (isDev) {
    return `http://localhost:5173/${page}.html`;
  }
  return `file://${path.join(__dirname, '..', 'renderer', `${page}.html`)}`;
}

let adminWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let warningWindow: BrowserWindow | null = null;

export function createAdminWindow(): BrowserWindow {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus();
    return adminWindow;
  }

  adminWindow = new BrowserWindow({
    width: 520,
    height: 600,
    resizable: false,
    title: 'Tee24 Bay Check-In Setup',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  adminWindow.loadURL(rendererUrl('admin'));
  adminWindow.on('closed', () => { adminWindow = null; });

  if (isDev) adminWindow.webContents.openDevTools({ mode: 'detach' });

  return adminWindow;
}

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    fullscreen: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.loadURL(rendererUrl('overlay'));
  overlayWindow.on('closed', () => { overlayWindow = null; });

  return overlayWindow;
}

export function createWarningWindow(): BrowserWindow {
  if (warningWindow && !warningWindow.isDestroyed()) {
    return warningWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

  warningWindow = new BrowserWindow({
    width,
    height: 48,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  warningWindow.setAlwaysOnTop(true, 'screen-saver');
  warningWindow.setVisibleOnAllWorkspaces(true);
  warningWindow.setIgnoreMouseEvents(true);
  warningWindow.loadURL(rendererUrl('warning'));
  warningWindow.on('closed', () => { warningWindow = null; });

  return warningWindow;
}

export function showOverlay(data: any): void {
  const win = createOverlayWindow();
  win.show();
  win.focus();
  win.webContents.send('show-overlay', data);
}

export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
    overlayWindow.webContents.send('hide-overlay');
  }
}

export function showWarning(data: any): void {
  const win = createWarningWindow();
  win.show();
  win.webContents.send('show-warning', data);
}

export function hideWarning(): void {
  if (warningWindow && !warningWindow.isDestroyed()) {
    warningWindow.hide();
    warningWindow.webContents.send('hide-warning');
  }
}

export function getAdminWindow(): BrowserWindow | null {
  return adminWindow && !adminWindow.isDestroyed() ? adminWindow : null;
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null;
}

export function getWarningWindow(): BrowserWindow | null {
  return warningWindow && !warningWindow.isDestroyed() ? warningWindow : null;
}
