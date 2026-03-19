import React, { useState, useEffect } from 'react';
import type { AppConfig, LocationInfo } from '../shared/types';
import LocationSelect from './LocationSelect';
import OtpLogin from './OtpLogin';
import BayAssign from './BayAssign';

type Step = 'server' | 'location' | 'otp' | 'bay';

export default function App() {
  const [step, setStep] = useState<Step>('server');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<LocationInfo | null>(null);

  useEffect(() => {
    window.bayApp.getConfig().then((cfg) => {
      setConfig(cfg);
      if (cfg.apiBaseUrl) setApiBaseUrl(cfg.apiBaseUrl);
    });
  }, []);

  async function handleServerSubmit() {
    const url = apiBaseUrl.trim().replace(/\/+$/, '');
    if (!url) return;
    await window.bayApp.setConfig({ apiBaseUrl: url });
    setConfig((c) => c ? { ...c, apiBaseUrl: url } : c);
    setStep('location');
  }

  function handleLocationSelected(loc: LocationInfo) {
    setSelectedLocation(loc);
    setStep('otp');
  }

  function handleOtpVerified() {
    setStep('bay');
  }

  async function handleBayAssigned(bayNumber: number) {
    if (!selectedLocation || !config) return;
    await window.bayApp.setConfig({
      locationId: selectedLocation.id,
      locationName: selectedLocation.name,
      bayNumber,
      configured: true,
    });
    await window.bayApp.startPoller();
  }

  return (
    <div style={{ padding: 32, maxWidth: 460, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Tee24 Bay Check-In</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Desktop app setup</p>
      </div>

      {step === 'server' && (
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Server Connection</h2>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            API Base URL
          </label>
          <input
            className="input"
            placeholder="https://your-tee24-app.vercel.app"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleServerSubmit()}
          />
          <p style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            The URL of your Tee24 booking app
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: 20, width: '100%' }}
            onClick={handleServerSubmit}
            disabled={!apiBaseUrl.trim()}
          >
            Connect
          </button>
        </div>
      )}

      {step === 'location' && config && (
        <LocationSelect
          onSelect={handleLocationSelected}
          onBack={() => setStep('server')}
        />
      )}

      {step === 'otp' && selectedLocation && (
        <OtpLogin
          locationId={selectedLocation.id}
          locationName={selectedLocation.name}
          onVerified={handleOtpVerified}
          onBack={() => setStep('location')}
        />
      )}

      {step === 'bay' && selectedLocation && config && (
        <BayAssign
          location={selectedLocation}
          deviceId={config.deviceId}
          onBack={() => setStep('otp')}
          onAssigned={handleBayAssigned}
        />
      )}
    </div>
  );
}
