import { useState } from 'react';
import { kiosk, isErr } from '../shared/bridge';
import type { AdminLocation, AdminSession } from '../shared/types';
import { AdminLogin } from '../shared/AdminLogin';
import { labelLM } from '../shared/TroubleshootFlow';

type Session = Omit<AdminSession, 'token'>;

/**
 * First-run wizard: admin signs in (Quo text code) → picks the location →
 * picks exactly one bay → this computer is registered to it.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  return (
    <div className="page">
      <div className="page-header">
        <span className="brand-mark">T24</span>
        <div>
          <h1>Set up this bay computer</h1>
          <div className="muted">Takes about a minute. You’ll need your admin phone.</div>
        </div>
      </div>
      <div className="page-body">
        {!session ? (
          <AdminLogin onSignedIn={setSession} title="Step 1 · Admin sign-in" />
        ) : (
          <AssignBay session={session} onDone={onDone} />
        )}
      </div>
    </div>
  );
}

export function AssignBay({ session, onDone, compact }: { session: Session; onDone: () => void; compact?: boolean }) {
  const locs = session.locations;
  const [locId, setLocId] = useState<string | null>(locs.length === 1 ? locs[0].id : null);
  const [bayNumber, setBayNumber] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ hostname?: string | null } | null>(null);

  const loc: AdminLocation | undefined = locs.find((l) => l.id === locId);

  async function register(force = false) {
    if (!locId || !bayNumber) return;
    setBusy(true);
    setError(null);
    setTaken(null);
    const r = await kiosk.adminRegister(locId, bayNumber, force);
    setBusy(false);
    if (isErr(r)) {
      if (r.code === 'BAY_TAKEN') {
        const d = (r.data ?? {}) as { hostname?: string | null };
        return setTaken({ hostname: d.hostname });
      }
      return setError(r.error);
    }
    onDone();
  }

  if (locs.length === 0) {
    return <div className="error">Your admin account doesn’t have access to any locations. Ask a root admin to grant access, then try again.</div>;
  }

  return (
    <div className="stack" style={{ maxWidth: compact ? undefined : 900, margin: compact ? undefined : '0 auto' }}>
      {!compact && <div className="card-title">Step 2 · Which bay is this computer in?</div>}

      {locs.length > 1 && (
        <div>
          <div className="label">Location</div>
          <div className="grid-3">
            {locs.map((l) => (
              <button key={l.id} className={`choice ${locId === l.id ? 'selected' : ''}`} onClick={() => { setLocId(l.id); setBayNumber(null); setTaken(null); }}>
                <strong>{l.name}</strong>
                <span>{l.bays.length} bays{l.bayAppEnabled ? '' : ' · kiosk reservations off'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loc && (
        <div>
          <div className="label">Bay (one per computer)</div>
          {loc.bays.length === 0 ? (
            <div className="error">No bays exist yet for {loc.name}. Add them in the admin console under Scheduling → Bays first.</div>
          ) : (
            <div className="grid-3">
              {loc.bays.map((b) => {
                const reg = loc.bayAppRegistrations.find((r) => r.bayNumber === b.number);
                return (
                  <button key={b.id} className={`choice ${bayNumber === b.number ? 'selected' : ''}`} onClick={() => { setBayNumber(b.number); setTaken(null); }}>
                    <strong>Bay {b.number}{b.name ? ` · ${b.name}` : ''}</strong>
                    <span>
                      {labelLM(b.launchMonitor)}
                      {reg ? ` · already has a computer${reg.hostname ? ` (${reg.hostname})` : ''}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {taken && (
        <div className="error">
          Bay {bayNumber} already has a computer assigned{taken.hostname ? ` (${taken.hostname})` : ''}. Only one computer can be assigned to a bay.
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => register(true)}>Replace it with this computer</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTaken(null)}>Pick a different bay</button>
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="row between">
        <span className="tiny">Signed in as {session.admin.name ?? 'admin'} · {session.admin.role}</span>
        <button className="btn btn-primary btn-lg" disabled={!locId || !bayNumber || busy} onClick={() => register(false)}>
          {busy ? <span className="spinner" /> : `Assign to Bay ${bayNumber ?? '…'}`}
        </button>
      </div>
    </div>
  );
}
