// Type-only re-exports from the main process (erased at build time).
export type { KioskState, OverlayMode } from '../../main/poller';
export type { StatusResponse, Booking, AdminLocation, AdminSession } from '../../main/api';
export type { KioskBridge } from '../../main/preload';
export type { KioskSettings } from '../../main/store';
export type { UpdatePhase } from '../../main/updater';
export type { RemoteAgentStatus } from '../../main/remote';
export type { LauncherState } from '../../main/launcher';
export type { FoundCsv, ExportResult } from '../../main/exports';

export type TroubleshootStep = {
  question?: string;
  subtext?: string;
  text?: string;
  buttonText?: string;
  externalLink?: string;
};
export type TroubleshootChoice = { next?: string; steps?: TroubleshootStep[] };
export type TroubleshootNode = {
  prompt?: string;
  category?: string;
  choices?: Record<string, TroubleshootChoice>;
  steps?: TroubleshootStep[];
};
export type TroubleshootTree = Record<string, TroubleshootNode>;

export type HelpResponse = {
  tree: TroubleshootTree;
  entryNodeId: string;
  commonNodeId: string;
  bay: { number: number; name: string | null; launchMonitor: string; setupNotes: string | null } | null;
  location: { name: string; slug: string; passAccessUrl: string | null } | null;
};

export type ScheduleResponse = {
  serverNow: string;
  dateISO: string;
  timezone: string;
  location: { name: string; open24Hours: boolean; hours: unknown };
  bay: { number: number };
  bookings: { id: string; firstName: string; lastInitial: string; start: string; end: string; checkedIn: boolean }[];
};

export type IpcError = { error: string; status?: number; code?: string; data?: unknown };
