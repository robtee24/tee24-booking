import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';

export interface AppConfig {
  deviceId: string;
  apiBaseUrl: string;
  locationId?: string;
  locationName?: string;
  bayNumber?: number;
  configured: boolean;
}

const store = new Store<AppConfig>({
  defaults: {
    deviceId: uuidv4(),
    apiBaseUrl: '',
    configured: false,
  },
});

export function getConfig(): AppConfig {
  return {
    deviceId: store.get('deviceId'),
    apiBaseUrl: store.get('apiBaseUrl'),
    locationId: store.get('locationId'),
    locationName: store.get('locationName'),
    bayNumber: store.get('bayNumber'),
    configured: store.get('configured'),
  };
}

export function setConfig(partial: Partial<AppConfig>): AppConfig {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      store.set(key as keyof AppConfig, value);
    }
  }
  return getConfig();
}

export function clearConfig(): void {
  const deviceId = store.get('deviceId');
  store.clear();
  store.set('deviceId', deviceId);
}

export function isConfigured(): boolean {
  const cfg = getConfig();
  return cfg.configured && !!cfg.locationId && cfg.bayNumber !== undefined && !!cfg.apiBaseUrl;
}
