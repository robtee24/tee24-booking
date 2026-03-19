import React, { useState, useEffect } from 'react';
import type { LocationInfo } from '../shared/types';

interface Props {
  onSelect: (loc: LocationInfo) => void;
  onBack: () => void;
}

export default function LocationSelect({ onSelect, onBack }: Props) {
  const [locations, setLocations] = useState<LocationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await window.bayApp.apiRequest('GET', '/api/bay-app/locations');
        setLocations(data.locations ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load locations');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const selectedLoc = locations.find((l) => l.id === selected);

  return (
    <div className="card">
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Select Location</h2>

      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>Loading locations...</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : locations.length === 0 ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>No locations found.</p>
      ) : (
        <>
          <select
            className="input"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a location...</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onBack}>
          Back
        </button>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={!selectedLoc}
          onClick={() => selectedLoc && onSelect(selectedLoc)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
