export interface AppConfig {
  deviceId: string;
  apiBaseUrl: string;
  locationId?: string;
  locationName?: string;
  bayNumber?: number;
  configured: boolean;
}

export interface LocationInfo {
  id: string;
  name: string;
  slug: string;
  bayAppEnabled: boolean;
  bays: Array<{ id: string; number: number; name: string | null }>;
  bayAppRegistrations: Array<{ bayNumber: number; deviceId: string }>;
}

export interface BookingInfo {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  start: string;
  end: string;
  checkedInAt?: string | null;
}

export interface BayStatus {
  location: {
    name: string;
    timezone: string;
    bayAppEnabled: boolean;
    bayAppUnlockMinutes: number;
    bayAppWarningMinutes: number;
    bayAppAutoCancelOnTimeout: boolean;
  };
  bay: {
    number: number;
    name: string | null;
  };
  currentBooking: BookingInfo | null;
  nextBooking: BookingInfo | null;
}

declare global {
  interface Window {
    bayApp: {
      getConfig: () => Promise<AppConfig>;
      setConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
      clearConfig: () => Promise<void>;
      startPoller: () => Promise<void>;
      dismissOverlay: () => Promise<void>;
      dismissWarning: () => Promise<void>;
      onShowOverlay: (cb: (data: BayStatus) => void) => () => void;
      onShowWarning: (cb: (data: BayStatus) => void) => () => void;
      onHideOverlay: (cb: () => void) => () => void;
      onHideWarning: (cb: () => void) => () => void;
      apiRequest: (method: string, url: string, body?: unknown) => Promise<any>;
    };
  }
}
