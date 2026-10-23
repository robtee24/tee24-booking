import { useEffect, useState } from 'react';
import { kiosk, isErr, formatPhoneInput } from './bridge';
import type { Booking, ExportResult, FoundCsv } from './types';
import { CheckIcon, FileIcon, MailIcon, PhoneIcon, UploadIcon } from './Icons';

/**
 * "Export" modal: find GSPro's Export-CSV output on this PC and send it to the
 * player's Tee24 app (analyzed under Improve → Sync latest data) and / or email it.
 *
 * Steps: pick files → choose destination → identify (phone / email) → done.
 */
export function ExportFlow({ currentBooking, onClose }: { currentBooking: Booking | null; onClose: () => void }) {
  const [files, setFiles] = useState<FoundCsv[] | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [delivery, setDelivery] = useState<'APP' | 'EMAIL' | 'BOTH'>('APP');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [useBooking, setUseBooking] = useState(!!currentBooking?.checkedInAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  async function scan() {
    setScanErr(null);
    const r = await kiosk.findExports();
    if (isErr(r)) return setScanErr(r.error);
    const found = (r as { files: FoundCsv[] }).files;
    setFiles(found);
    // Preselect the newest file — that's almost always the session just played.
    if (found.length && picked.size === 0) setPicked(new Set([found[0].path]));
  }

  useEffect(() => {
    void scan();
    const t = setInterval(() => void scan(), 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const digits = phone.replace(/\D/g, '');
  const wantsApp = delivery !== 'EMAIL';
  const wantsEmail = delivery !== 'APP';
  const needPhone = wantsApp && !useBooking;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSend = picked.size > 0 && (!needPhone || digits.length === 10) && (!wantsEmail || emailOk || useBooking);

  function toggle(p: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setErr(null);
    const r = await kiosk.sendExports({
      paths: [...picked],
      delivery,
      bookingId: useBooking && currentBooking ? currentBooking.id : null,
      phone: needPhone ? digits : null,
      email: wantsEmail && email.trim() ? email.trim() : null,
    });
    setBusy(false);
    if (isErr(r)) {
      if (r.code === 'PHONE_REQUIRED') setUseBooking(false);
      if (r.code === 'EMAIL_REQUIRED') setUseBooking(false);
      return setErr(r.error);
    }
    setResult(r as ExportResult);
  }

  if (result) {
    const shots = result.exports.reduce((n, e) => n + e.shotCount, 0);
    return (
      <div style={{ textAlign: 'center', padding: '24px 8px' }}>
        <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(34,197,94,0.2)', color: '#86efac', display: 'grid', placeItems: 'center', margin: '0 auto 20px' }}>
          <CheckIcon size={44} />
        </div>
        <h2 style={{ fontSize: 30, fontWeight: 800 }}>
          {result.exports.length} file{result.exports.length === 1 ? '' : 's'} · {shots} shot{shots === 1 ? '' : 's'} sent
        </h2>
        <div className="muted" style={{ marginTop: 12, fontSize: 18, lineHeight: 1.5 }}>
          {result.pendingForApp && (
            <p>
              {result.matched
                ? <>Open the Tee24 app{result.member?.firstName ? `, ${result.member.firstName}` : ''} → <b>Improve</b> → <b>Sync latest data</b> to see your analysis.</>
                : <>We couldn't find a Tee24 account for that number yet. The data is saved — once you join with this phone number, it'll appear under <b>Improve → Sync latest data</b>.</>}
            </p>
          )}
          {result.emailedTo && <p style={{ marginTop: 8 }}>A copy is on its way to <b>{result.emailedTo}</b>.</p>}
          {wantsEmail && !result.emailedTo && <p className="error" style={{ marginTop: 8 }}>The email didn't go out — ask the front desk to resend it.</p>}
        </div>
        <button className="btn btn-primary btn-lg" style={{ marginTop: 28 }} onClick={onClose}>Done</button>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* 1. Files */}
      <section>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>1. Pick your shot data</div>
          <button className="btn btn-ghost" onClick={() => void scan()} style={{ fontSize: 14 }}>Rescan</button>
        </div>
        {files === null && !scanErr && <div className="muted">Looking for GSPro exports…</div>}
        {scanErr && <div className="error">{scanErr}</div>}
        {files && files.length === 0 && (
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>No export found yet. In GSPro:</div>
            <ol className="export-steps">
              <li>Click the <b>clipboard</b> icon in the top-left of the Practice Range / On-Course Practice screen.</li>
              <li>Click <b>Export CSV</b> — GSPro saves the file to this PC's Desktop.</li>
              <li>Come back here; the file appears automatically.</li>
            </ol>
            <div className="tiny" style={{ marginTop: 10 }}>Do this before ending the session — GSPro doesn't keep shot history.</div>
          </div>
        )}
        {files && files.length > 0 && (
          <div className="export-files">
            {files.map((f) => {
              const on = picked.has(f.path);
              return (
                <button key={f.path} className={`export-file ${on ? 'on' : ''}`} onClick={() => toggle(f.path)}>
                  <span className="check">{on && <CheckIcon size={18} />}</span>
                  <FileIcon size={22} style={{ color: 'var(--text-2)', flex: 'none' }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="name">{f.name}</span>
                    <span className="tiny" style={{ display: 'block' }}>
                      {f.shots != null ? `${f.shots} shots` : 'shot data'}
                      {f.clubs.length ? ` · ${f.clubs.slice(0, 4).join(', ')}` : ''} · {timeAgo(f.modifiedAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Destination */}
      <section>
        <div className="card-title" style={{ marginBottom: 10 }}>2. Where should it go?</div>
        <div className="export-choice">
          <button className={delivery === 'APP' || delivery === 'BOTH' ? 'on' : ''} onClick={() => setDelivery((d) => (d === 'APP' ? 'APP' : d === 'EMAIL' ? 'BOTH' : 'EMAIL'))}>
            <PhoneIcon size={24} style={{ color: '#86efac' }} />
            <b>Send to my Tee24 app</b>
            <span>Analyzed under Improve → Sync latest data</span>
          </button>
          <button className={delivery === 'EMAIL' || delivery === 'BOTH' ? 'on' : ''} onClick={() => setDelivery((d) => (d === 'EMAIL' ? 'EMAIL' : d === 'APP' ? 'BOTH' : 'APP'))}>
            <MailIcon size={24} style={{ color: '#93c5fd' }} />
            <b>Email me the file</b>
            <span>CSV attached, keep it anywhere</span>
          </button>
        </div>
      </section>

      {/* 3. Identify */}
      <section>
        <div className="card-title" style={{ marginBottom: 10 }}>3. Who is it for?</div>
        {currentBooking && (
          <button className={`export-file ${useBooking ? 'on' : ''}`} onClick={() => setUseBooking((v) => !v)} style={{ marginBottom: 10 }}>
            <span className="check">{useBooking && <CheckIcon size={18} />}</span>
            <span style={{ flex: 1 }}>
              <span className="name">{currentBooking.firstName} {currentBooking.lastInitial}. — this reservation</span>
              <span className="tiny" style={{ display: 'block' }}>Uses the account on the booking{wantsEmail ? ' (and its email, unless you type another below)' : ''}</span>
            </span>
          </button>
        )}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {needPhone && (
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              inputMode="tel"
              placeholder="Phone on your Tee24 account"
              value={formatPhoneInput(phone)}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          )}
          {wantsEmail && (
            <input
              className="input"
              style={{ flex: 1, minWidth: 220 }}
              inputMode="email"
              placeholder={useBooking ? 'Different email (optional)' : 'Email address'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          {!needPhone && !wantsEmail && <div className="muted">We'll deliver it to the account on this reservation.</div>}
        </div>
      </section>

      {err && <div className="error">{err}</div>}

      <div className="row between">
        <div className="tiny">Files stay on this PC. Spectators' and guests' shots count toward whoever you send it to.</div>
        <button className="btn btn-primary btn-lg" disabled={!canSend || busy} onClick={send}>
          {busy ? <span className="spinner" /> : <UploadIcon size={20} />} Send {picked.size > 1 ? `${picked.size} files` : ''}
        </button>
      </div>
    </div>
  );
}

function timeAgo(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
