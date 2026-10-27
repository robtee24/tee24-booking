import { useEffect, useState } from 'react';
import { kiosk, isErr } from '../shared/bridge';
import type { AdminSession, KioskState, RemoteAgentStatus, UpdatePhase } from '../shared/types';
import { AdminLogin } from '../shared/AdminLogin';
import { AssignBay } from './Setup';
import { labelLM } from '../shared/TroubleshootFlow';
import { BackIcon } from '../shared/Icons';

type Session = Omit<AdminSession, 'token'>;
type Tab = 'bay' | 'assignment' | 'launch' | 'remote' | 'app';

const LMS = ['IDRA', 'SKYTRAK', 'PROTEE_VX', 'OTHER'];

/**
 * Admin-only Settings (gear, top-right). Gate: Quo text-message sign-in; the
 * session lives in the main process and expires after 30 idle minutes.
 */
export function Settings({ state, onClose }: { state: KioskState; onClose: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('bay');

  useEffect(() => {
    kiosk.adminSession().then((s) => setSession((s as Session | null) ?? null));
  }, []);

  async function signOut() {
    await kiosk.adminSignOut();
    setSession(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn btn-ghost" onClick={onClose}><BackIcon size={20} /> Back</button>
        <h1>Settings</h1>
        {session && (
          <div className="row" style={{ marginLeft: 'auto' }}>
            <span className="tiny">{session.admin.name ?? 'Admin'} · {session.admin.role}</span>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>

      <div className="page-body">
        {session === undefined ? (
          <div className="row muted"><span className="spinner" /> Checking sign-in…</div>
        ) : !session ? (
          <AdminLogin onSignedIn={setSession} subtitle="Settings are for Tee24 admins only. Sign in with the phone number on your admin account." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24 }}>
            <nav className="stack" style={{ gap: 6 }}>
              {([
                ['bay', 'Bay details'],
                ['assignment', 'Bay assignment'],
                ['launch', 'Play button'],
                ['remote', 'Remote support'],
                ['app', 'App & updates'],
              ] as [Tab, string][]).map(([k, label]) => (
                <button key={k} className={`choice ${tab === k ? 'selected' : ''}`} style={{ minHeight: 56, padding: '14px 18px' }} onClick={() => setTab(k)}>
                  <strong style={{ fontSize: 17 }}>{label}</strong>
                </button>
              ))}
            </nav>
            <div>
              {tab === 'bay' && <BayDetails state={state} />}
              {tab === 'assignment' && <Assignment state={state} session={session} onChanged={async () => setSession((await kiosk.adminSession()) as Session)} />}
              {tab === 'launch' && <LaunchPaths state={state} />}
              {tab === 'remote' && <Remote />}
              {tab === 'app' && <AppUpdates state={state} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Bay details (name / launch monitor / setup notes) ----------

function BayDetails({ state }: { state: KioskState }) {
  const bay = state.status?.bay;
  const [name, setName] = useState(bay?.name ?? state.settings.bayName ?? '');
  const [lm, setLm] = useState(bay?.launchMonitor ?? state.settings.launchMonitor ?? 'OTHER');
  const [notes, setNotes] = useState(bay?.setupNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await kiosk.adminPatchBay({ name: name.trim() || null, launchMonitor: lm, setupNotes: notes.trim() || null });
    setBusy(false);
    if (isErr(r)) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: 'Saved. Changes apply to the web admin too.' });
  }

  return (
    <div className="card stack">
      <div>
        <div className="card-title">Bay {state.settings.bayNumber} at {state.settings.locationName}</div>
        <div className="card-sub">These are the same settings as Scheduling → Bays in the admin console.</div>
      </div>
      <div className="field">
        <label className="label">Bay name (optional)</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Left bay" maxLength={80} />
      </div>
      <div className="field">
        <label className="label">Launch monitor</label>
        <select className="select" value={lm} onChange={(e) => setLm(e.target.value)}>
          {LMS.map((v) => <option key={v} value={v}>{labelLM(v)}</option>)}
        </select>
        <div className="hint">Picks which troubleshooting guide the Help button opens.</div>
      </div>
      <div className="field">
        <label className="label">Setup notes (shown under Setup Help)</label>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything specific to this bay: camera placement, tee position, projector input…" />
      </div>
      {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : 'Save bay details'}</button>
      </div>
    </div>
  );
}

// ---------- Assignment (reassign / unassign) ----------

function Assignment({ state, session, onChanged }: { state: KioskState; session: Session; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'reassign'>('view');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unassign() {
    if (!confirm('Unassign this computer from its bay? The kiosk will return to the setup screen.')) return;
    setBusy(true);
    const r = await kiosk.adminUnregister();
    setBusy(false);
    if (isErr(r)) return setErr(r.error);
  }

  return (
    <div className="card stack">
      <div>
        <div className="card-title">Bay assignment</div>
        <div className="card-sub">Each computer is assigned to exactly one bay.</div>
      </div>
      <dl className="kv">
        <dt>Location</dt><dd>{state.settings.locationName}</dd>
        <dt>Bay</dt><dd>Bay {state.settings.bayNumber}{state.settings.bayName ? ` · ${state.settings.bayName}` : ''}</dd>
        <dt>Device id</dt><dd className="tiny">{state.settings.deviceId}</dd>
      </dl>
      {err && <div className="error">{err}</div>}
      {mode === 'view' ? (
        <div className="row">
          <button className="btn" onClick={() => setMode('reassign')}>Move to a different bay</button>
          <button className="btn btn-danger" disabled={busy} onClick={unassign}>Unassign this computer</button>
        </div>
      ) : (
        <>
          <AssignBay session={session} compact onDone={() => { setMode('view'); onChanged(); }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setMode('view')}>Cancel</button>
        </>
      )}
    </div>
  );
}

// ---------- Launch paths ----------

function LaunchPaths({ state }: { state: KioskState }) {
  const [lmPath, setLmPath] = useState(state.settings.launchMonitorPath);
  const [gsPath, setGsPath] = useState(state.settings.gsproPath);
  const [exists, setExists] = useState<{ launchMonitor: boolean; gspro: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setExists((await kiosk.adminPathsExist()) as { launchMonitor: boolean; gspro: boolean });
  }
  useEffect(() => { refresh(); }, []);

  async function save() {
    const r = await kiosk.adminSaveLocal({ launchMonitorPath: lmPath.trim(), gsproPath: gsPath.trim() });
    if (isErr(r)) return setMsg(r.error);
    setMsg('Saved.');
    refresh();
  }

  async function browse(which: 'lm' | 'gs') {
    const p = await kiosk.adminBrowseExe(which === 'gs' ? 'Choose GSPro.exe' : 'Choose the launch monitor program');
    if (typeof p === 'string') (which === 'gs' ? setGsPath : setLmPath)(p);
  }

  const lmOwnsGspro = /IDRAMonitor\.exe$/i.test(lmPath.trim());

  return (
    <div className="card stack">
      <div>
        <div className="card-title">What “Play” launches</div>
        <div className="card-sub">
          {lmOwnsGspro
            ? 'IDRAMonitor.exe opens GSPro and the IDRA connection itself (the same thing the GolfIn Launcher’s IDRA tile does), so Play only starts that. The GSPro path below is used for Export and the Test button.'
            : 'Both programs start together. Leave the launch monitor blank if GSPro connects to it directly.'}
        </div>
      </div>
      <div className="field">
        <label className="label">Launch monitor software ({labelLM(state.settings.launchMonitor)})</label>
        <div className="row">
          <input className="input" value={lmPath} onChange={(e) => setLmPath(e.target.value)} placeholder="C:\Program Files\Sim Sports Corporation\IDRA\<version>\IDRAMonitor.exe" />
          <button className="btn" onClick={() => browse('lm')}>Browse</button>
          <button className="btn btn-sm" onClick={() => kiosk.adminLaunch('launchMonitor')} disabled={!lmPath}>Test</button>
        </div>
        {exists && lmPath && <div className={`hint ${exists.launchMonitor ? '' : 'error'}`} style={{ marginTop: 8 }}>{exists.launchMonitor ? 'Found.' : 'Not found at this path.'}</div>}
      </div>
      <div className="field">
        <label className="label">GSPro</label>
        <div className="row">
          <input className="input" value={gsPath} onChange={(e) => setGsPath(e.target.value)} placeholder="C:\GSProV1\Core\GSP\GSPro.exe" />
          <button className="btn" onClick={() => browse('gs')}>Browse</button>
          <button className="btn btn-sm" onClick={() => kiosk.adminLaunch('gspro')} disabled={!gsPath}>Test</button>
        </div>
        {exists && <div className={`hint ${exists.gspro ? '' : 'error'}`} style={{ marginTop: 8 }}>{exists.gspro ? 'Found.' : 'Not found at this path.'}</div>}
      </div>
      {msg && <div className="success">{msg}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={save}>Save paths</button>
      </div>
    </div>
  );
}

// ---------- Remote support (MeshCentral agent) ----------

function Remote() {
  const [st, setSt] = useState<RemoteAgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    const r = await kiosk.adminRemoteStatus();
    if (!isErr(r)) setSt(r as RemoteAgentStatus);
  }
  useEffect(() => {
    refresh();
    return kiosk.onProgress(setProgress);
  }, []);

  async function install() {
    setBusy(true);
    setErr(null);
    const r = await kiosk.adminRemoteInstall();
    setBusy(false);
    setProgress(null);
    if (isErr(r)) return setErr(r.error);
    setSt(r as RemoteAgentStatus);
  }
  async function uninstall() {
    if (!confirm('Remove the remote support agent from this computer?')) return;
    setBusy(true);
    const r = await kiosk.adminRemoteUninstall();
    setBusy(false);
    if (isErr(r)) return setErr(r.error);
    setSt(r as RemoteAgentStatus);
  }

  return (
    <div className="card stack">
      <div>
        <div className="card-title">Remote support</div>
        <div className="card-sub">
          Lets admins remote into this computer from the Troubleshoot tab in the admin console. Uses the open-source MeshCentral agent — it only connects out to Tee24’s own server; nothing is opened on this PC.
        </div>
      </div>
      {!st ? (
        <div className="row muted"><span className="spinner" /> Checking…</div>
      ) : (
        <dl className="kv">
          <dt>Status</dt>
          <dd>{st.installed ? <span className="badge badge-ok"><span className="dot" /> Agent installed</span> : <span className="badge badge-warn">Not installed</span>}</dd>
          <dt>Server</dt><dd>{st.serverUrl ?? <span className="muted">Not configured on the server yet</span>}</dd>
          <dt>Device id</dt><dd className="tiny">{st.nodeId ?? '—'}</dd>
        </dl>
      )}
      {progress && <div className="row muted"><span className="spinner" /> {progress}</div>}
      {err && <div className="error">{err}</div>}
      <div className="row">
        {!st?.installed ? (
          <button className="btn btn-primary" disabled={busy || !st?.serverUrl} onClick={install}>{busy ? <span className="spinner" /> : 'Install remote support agent'}</button>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={install}>Reinstall / repair</button>
            <button className="btn btn-danger" disabled={busy} onClick={uninstall}>Remove agent</button>
          </>
        )}
        <button className="btn btn-ghost" onClick={refresh}>Refresh</button>
      </div>
      <div className="hint">Windows will ask for permission (UAC) during install. The device id is reported to the admin console automatically.</div>
    </div>
  );
}

// ---------- App & updates ----------

function AppUpdates({ state }: { state: KioskState }) {
  const [phase, setPhase] = useState<UpdatePhase | null>(null);
  const [apiUrl, setApiUrl] = useState(state.settings.apiBaseUrl);
  const [openAtLogin, setOpenAtLogin] = useState(state.settings.openAtLogin);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => kiosk.onUpdate((p) => setPhase(p as UpdatePhase)), []);

  async function save() {
    const r = await kiosk.adminSaveLocal({ apiBaseUrl: apiUrl.trim().replace(/\/+$/, ''), openAtLogin });
    setMsg(isErr(r) ? r.error : 'Saved.');
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <div className="card-title">Tee24 Bay Kiosk v{state.version}</div>
          <div className="card-sub">The kiosk checks for updates every time it opens and installs them automatically.</div>
        </div>
        {phase && (
          <div className="muted">
            {phase.phase === 'checking' && 'Checking for updates…'}
            {phase.phase === 'none' && 'You’re on the latest version.'}
            {phase.phase === 'downloading' && `Downloading update… ${phase.percent}%`}
            {phase.phase === 'installing' && 'Installing — the kiosk will restart.'}
            {phase.phase === 'error' && `Update check failed: ${phase.message}`}
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={() => kiosk.adminCheckUpdates()}>Check for updates now</button>
          <button className="btn btn-ghost" onClick={() => kiosk.adminRestart()}>Restart kiosk</button>
          <button className="btn btn-ghost" onClick={() => { if (confirm('Quit the kiosk? It will start again at next login.')) kiosk.adminQuit(); }}>Quit to Windows</button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Startup</div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={openAtLogin} onChange={(e) => setOpenAtLogin(e.target.checked)} style={{ width: 22, height: 22 }} />
          Open the kiosk automatically when Windows starts
        </label>
        <div className="field">
          <label className="label">Server</label>
          <input className="input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          <div className="hint">Leave as https://reservations.tee24.golf unless told otherwise.</div>
        </div>
        {msg && <div className="success">{msg}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Status</div>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Connection</dt><dd>{state.online ? 'Connected' : `Offline${state.lastError ? ` — ${state.lastError}` : ''}`}</dd>
          <dt>Last sync</dt><dd>{state.lastPollAt ? new Date(state.lastPollAt).toLocaleTimeString() : '—'}</dd>
          <dt>Kiosk reservations</dt><dd>{state.status?.location.bayAppEnabled ? 'On for this location' : 'Off for this location (turn on in admin → Settings → Bay kiosk)'}</dd>
          <dt>Clock offset</dt><dd>{Math.round(state.serverOffsetMs / 1000)}s vs server</dd>
          <dt>Staff shortcut</dt><dd>Ctrl + Shift + T brings this screen over GSPro</dd>
        </dl>
      </div>
    </div>
  );
}
