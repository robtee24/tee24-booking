import React, { useState } from 'react';
import type { LocationInfo } from '../shared/types';

interface Props {
  location: LocationInfo;
  deviceId: string;
  onBack: () => void;
  onAssigned: (bayNumber: number) => void;
}

export default function BayAssign({ location, deviceId, onBack, onAssigned }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registeredBays = new Set(
    location.bayAppRegistrations
      .filter((r) => r.deviceId !== deviceId)
      .map((r) => r.bayNumber)
  );

  const availableBays = location.bays.filter((b) => !registeredBays.has(b.number));

  async function handleAssign() {
    if (selected === null) return;
    try {
      setLoading(true);
      setError(null);
      const result = await window.bayApp.apiRequest('POST', '/api/bay-app/register', {
        locationId: location.id,
        bayNumber: selected,
        deviceId,
      });
      if (result.ok) {
        onAssigned(selected);
      } else {
        setError(result.error ?? 'Registration failed');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Assign Bay</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
        Select the bay this computer is assigned to at <strong>{location.name}</strong>
      </p>

      {availableBays.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          All bays already have registered devices. Unregister a device first.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
          {availableBays.map((bay) => (
            <button
              key={bay.number}
              onClick={() => setSelected(bay.number)}
              style={{
                padding: '14px 8px',
                border: `2px solid ${selected === bay.number ? 'var(--color-blue)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-sm)',
                background: selected === bay.number ? 'rgba(0, 122, 255, 0.06)' : 'var(--color-card)',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>Bay {bay.number}</div>
              {bay.name && (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{bay.name}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onBack}>Back</button>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={selected === null || loading}
          onClick={handleAssign}
        >
          {loading ? 'Setting up...' : 'Run'}
        </button>
      </div>
    </div>
  );
}
