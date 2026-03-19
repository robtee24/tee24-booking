import { app, ipcMain, BrowserWindow, net } from 'electron';
import path from 'path';
import { getConfig, setConfig, clearConfig, isConfigured } from './store';
import { createAdminWindow, hideOverlay, hideWarning } from './windows';
import { startPolling, stopPolling, notifyCheckInComplete, notifyCancelComplete } from './poller';

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    createAdminWindow();
  });

  app.whenReady().then(() => {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: app.getPath('exe'),
    });

    registerIpcHandlers();

    if (isConfigured()) {
      startPolling();
    } else {
      createAdminWindow();
    }
  });

  app.on('window-all-closed', (e: Event) => {
    // Keep the app running in the background even if all windows are closed
    e.preventDefault();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAdminWindow();
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('get-config', () => {
    return getConfig();
  });

  ipcMain.handle('set-config', (_event, partial: Record<string, unknown>) => {
    return setConfig(partial as any);
  });

  ipcMain.handle('clear-config', () => {
    stopPolling();
    clearConfig();
    return true;
  });

  ipcMain.handle('start-poller', () => {
    startPolling();
    return true;
  });

  ipcMain.handle('dismiss-overlay', () => {
    notifyCheckInComplete();
    return true;
  });

  ipcMain.handle('dismiss-warning', () => {
    hideWarning();
    return true;
  });

  ipcMain.handle('api-request', async (_event, method: string, urlPath: string, body?: unknown) => {
    const config = getConfig();
    if (!config.apiBaseUrl) throw new Error('API base URL not configured');

    const url = `${config.apiBaseUrl}${urlPath}`;

    return new Promise((resolve, reject) => {
      const request = net.request({
        method: method.toUpperCase(),
        url,
      });

      if (body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PATCH' || method.toUpperCase() === 'PUT')) {
        request.setHeader('Content-Type', 'application/json');
      }

      let responseBody = '';

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseBody += chunk.toString();
        });

        response.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            if (response.statusCode && response.statusCode >= 400) {
              reject(new Error(parsed.error || `Request failed (${response.statusCode})`));
            } else {
              resolve(parsed);
            }
          } catch {
            if (response.statusCode && response.statusCode >= 400) {
              reject(new Error(`Request failed (${response.statusCode})`));
            } else {
              resolve(responseBody);
            }
          }
        });
      });

      request.on('error', (err) => {
        reject(err);
      });

      if (body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PATCH' || method.toUpperCase() === 'PUT')) {
        request.write(JSON.stringify(body));
      }

      request.end();
    });
  });
}
