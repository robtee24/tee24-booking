import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bayApp', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('set-config', config),
  clearConfig: () => ipcRenderer.invoke('clear-config'),
  startPoller: () => ipcRenderer.invoke('start-poller'),
  dismissOverlay: () => ipcRenderer.invoke('dismiss-overlay'),
  dismissWarning: () => ipcRenderer.invoke('dismiss-warning'),
  onShowOverlay: (cb: (data: any) => void) => {
    ipcRenderer.on('show-overlay', (_e, data) => cb(data));
    return () => { ipcRenderer.removeAllListeners('show-overlay'); };
  },
  onShowWarning: (cb: (data: any) => void) => {
    ipcRenderer.on('show-warning', (_e, data) => cb(data));
    return () => { ipcRenderer.removeAllListeners('show-warning'); };
  },
  onHideOverlay: (cb: () => void) => {
    ipcRenderer.on('hide-overlay', () => cb());
    return () => { ipcRenderer.removeAllListeners('hide-overlay'); };
  },
  onHideWarning: (cb: () => void) => {
    ipcRenderer.on('hide-warning', () => cb());
    return () => { ipcRenderer.removeAllListeners('hide-warning'); };
  },
  apiRequest: (method: string, url: string, body?: unknown) =>
    ipcRenderer.invoke('api-request', method, url, body),
});
