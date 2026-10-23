import { contextBridge, ipcRenderer } from 'electron';

/**
 * Renderer ↔ main bridge. Every call is a request/response over IPC; no Node
 * APIs are exposed to the page. The admin bearer token never leaves main.
 */
const api = {
  // State stream
  getState: () => ipcRenderer.invoke('kiosk:getState'),
  onState: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('kiosk:state', handler);
    return () => {
      ipcRenderer.removeListener('kiosk:state', handler);
    };
  },
  onUpdate: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('kiosk:update', handler);
    return () => {
      ipcRenderer.removeListener('kiosk:update', handler);
    };
  },

  // Player actions
  play: () => ipcRenderer.invoke('kiosk:play'),
  openOverlay: (mode: 'help' | 'schedule' | 'export' | 'none') => ipcRenderer.invoke('kiosk:overlay', mode),
  acceptUpcoming: (bookingId: string) => ipcRenderer.invoke('kiosk:acceptUpcoming', bookingId),
  checkIn: (bookingId: string, phone: string) => ipcRenderer.invoke('kiosk:checkIn', bookingId, phone),
  getSchedule: (dateISO?: string) => ipcRenderer.invoke('kiosk:schedule', dateISO),
  getHelp: () => ipcRenderer.invoke('kiosk:help'),
  // GSPro shot-data export → Tee24 app / email
  findExports: () => ipcRenderer.invoke('kiosk:findExports'),
  sendExports: (input: { paths: string[]; delivery: 'APP' | 'EMAIL' | 'BOTH'; bookingId?: string | null; phone?: string | null; email?: string | null }) =>
    ipcRenderer.invoke('kiosk:sendExports', input),

  // Admin (Quo SMS sign-in)
  adminSendOtp: (phone: string) => ipcRenderer.invoke('admin:sendOtp', phone),
  adminVerifyOtp: (phone: string, code: string) => ipcRenderer.invoke('admin:verifyOtp', phone, code),
  adminSession: () => ipcRenderer.invoke('admin:session'),
  adminSignOut: () => ipcRenderer.invoke('admin:signOut'),
  adminRegister: (locationId: string, bayNumber: number, force?: boolean) =>
    ipcRenderer.invoke('admin:register', locationId, bayNumber, !!force),
  adminUnregister: () => ipcRenderer.invoke('admin:unregister'),
  adminPatchBay: (patch: { name?: string | null; launchMonitor?: string; setupNotes?: string | null }) =>
    ipcRenderer.invoke('admin:patchBay', patch),
  adminSaveLocal: (patch: Record<string, unknown>) => ipcRenderer.invoke('admin:saveLocal', patch),
  adminBrowseExe: (title: string) => ipcRenderer.invoke('admin:browseExe', title),
  adminLaunch: (which: 'launchMonitor' | 'gspro') => ipcRenderer.invoke('admin:launch', which),
  adminPathsExist: () => ipcRenderer.invoke('admin:pathsExist'),
  adminRemoteStatus: () => ipcRenderer.invoke('admin:remoteStatus'),
  adminRemoteInstall: () => ipcRenderer.invoke('admin:remoteInstall'),
  adminRemoteUninstall: () => ipcRenderer.invoke('admin:remoteUninstall'),
  adminCheckUpdates: () => ipcRenderer.invoke('admin:checkUpdates'),
  adminRestart: () => ipcRenderer.invoke('admin:restart'),
  adminQuit: () => ipcRenderer.invoke('admin:quit'),
  adminOpenExternal: (url: string) => ipcRenderer.invoke('admin:openExternal', url),
  onProgress: (cb: (msg: string) => void) => {
    const handler = (_e: unknown, m: string) => cb(m);
    ipcRenderer.on('admin:progress', handler);
    return () => {
      ipcRenderer.removeListener('admin:progress', handler);
    };
  },
};

contextBridge.exposeInMainWorld('kiosk', api);

export type KioskBridge = typeof api;
