'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { MERGE_FIELDS } from "@/lib/template-vars";

/* ----------------------------- Types ----------------------------- */
type ScheduledItem = {
  id?: string;
  offsetHours: number;
  enabled: boolean;
  template: string;
  orderIndex: number;
};

type LoadedData = {
  location: { id: string; name: string; slug: string };
  confirmations: {
    email: { enabled: boolean; template: string };
    sms: { enabled: boolean; template: string };
  };
  notifications: {
    emails: ScheduledItem[];
    texts: ScheduledItem[];
  };
  changeNotifications: {
    email: { enabled: boolean; template: string };
    sms: { enabled: boolean; template: string };
  };
};

/* ------------------------- Merge Fields UI ------------------------ */
const mergeFieldKeys = MERGE_FIELDS.recommended;

function insertAtCaret_contentEditable(el: HTMLElement, html: string) {
  el.focus();
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) {
    el.insertAdjacentHTML('beforeend', html);
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const frag = document.createDocumentFragment();
  let node: ChildNode | null = null;
  let lastNode: ChildNode | null = null;
  while ((node = temp.firstChild)) {
    lastNode = frag.appendChild(node);
  }
  range.insertNode(frag);
  if (lastNode) {
    const newRange = range.cloneRange();
    newRange.setStartAfter(lastNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

function insertAtCaret_textarea(textarea: HTMLTextAreaElement, text: string) {
  const { selectionStart = textarea.value.length, selectionEnd = selectionStart } = textarea;
  const before = textarea.value.slice(0, selectionStart);
  const after = textarea.value.slice(selectionEnd);
  textarea.value = before + text + after;
  const pos = before.length + text.length;
  textarea.setSelectionRange(pos, pos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ------------------------- Rich Email Editor ------------------------- */
function EmailToolbar({
  onCmd,
  onLink,
  onClear,
  onMerge,
}: {
  onCmd: (cmd: 'bold' | 'italic' | 'underline' | 'ol' | 'ul') => void;
  onLink: () => void;
  onClear: () => void;
  onMerge: (field: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-apple-sm">
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onCmd('bold')} className="rounded-apple-sm border border-apple-border px-2 py-1 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">B</button>
        <button type="button" onClick={() => onCmd('italic')} className="rounded-apple-sm border border-apple-border px-2 py-1 italic text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">I</button>
        <button type="button" onClick={() => onCmd('underline')} className="rounded-apple-sm border border-apple-border px-2 py-1 underline text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">U</button>
      </div>
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onCmd('ul')} className="rounded-apple-sm border border-apple-border px-2 py-1 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">• List</button>
        <button type="button" onClick={() => onCmd('ol')} className="rounded-apple-sm border border-apple-border px-2 py-1 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">1. List</button>
      </div>
      <button type="button" onClick={onLink} className="rounded-apple-sm border border-apple-border px-2 py-1 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">Link</button>
      <button type="button" onClick={onClear} className="rounded-apple-sm border border-apple-border px-2 py-1 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text">Clear</button>
      <div className="ml-auto inline-flex items-center gap-1 flex-wrap">
        <span className="text-apple-text-tertiary text-apple-xs">Merge:</span>
        <div className="flex flex-wrap gap-1">
          {mergeFieldKeys.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onMerge(f)}
              className="rounded-apple-sm border border-apple-blue/20 bg-apple-blue/5 px-2 py-0.5 text-apple-xs text-apple-blue transition-colors hover:bg-apple-blue/10"
              title={`Insert {{${f}}}`}
            >
              {'{{' + f + '}}'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RichEmailEditor({
  value,
  onChange,
  placeholder = 'Write email template…',
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const exec = (cmd: 'bold' | 'italic' | 'underline' | 'ol' | 'ul') => {
    const map: Record<typeof cmd, string> = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      ol: 'insertOrderedList',
      ul: 'insertUnorderedList',
    };
    document.execCommand(map[cmd]);
    const el = ref.current;
    if (el) onChange(el.innerHTML);
  };

  const doLink = () => {
    const url = prompt('Enter URL[](https://…):');
    if (!url) return;
    document.execCommand('createLink', false, url);
    const el = ref.current;
    if (el) onChange(el.innerHTML);
  };

  const clearFmt = () => {
    document.execCommand('removeFormat');
    const el = ref.current;
    if (el) onChange(el.innerHTML);
  };

  const insertMerge = (field: string) => {
    const el = ref.current;
    if (!el) return;
    insertAtCaret_contentEditable(el, `{{${field}}}`);
    onChange(el.innerHTML);
  };

  return (
    <div>
      <EmailToolbar onCmd={exec} onLink={doLink} onClear={clearFmt} onMerge={insertMerge} />
      <div
        ref={ref}
        className="min-h-[160px] w-full rounded-apple-sm border border-apple-border bg-white p-3 prose max-w-none text-apple-sm text-apple-text focus:outline-none focus:border-apple-blue"
        contentEditable
        role="textbox"
        aria-label="Email template editor"
        data-placeholder={placeholder}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        suppressContentEditableWarning
        style={{ whiteSpace: 'pre-wrap' }}
      />
      <p className="mt-1.5 text-apple-xs text-apple-text-tertiary">
        HTML editor. Merge fields: <code className="rounded bg-apple-fill-secondary px-1">{'{{firstName}}'}</code>
      </p>
    </div>
  );
}

/* --------------------------- SMS Helper UI --------------------------- */
function SmsToolbar({
  textareaRef,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-apple-sm">
      <button
        type="button"
        className="rounded-apple-sm border border-apple-border px-2 py-1 text-apple-text-secondary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
        onClick={() => {
          const el = textareaRef.current;
          if (!el) return;
          insertAtCaret_textarea(el, '\n');
        }}
      >
        New line
      </button>
      <div className="ml-auto inline-flex items-center gap-1 flex-wrap">
        <span className="text-apple-text-tertiary text-apple-xs">Merge:</span>
        <div className="flex flex-wrap gap-1">
          {mergeFieldKeys.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                const el = textareaRef.current;
                if (!el) return;
                insertAtCaret_textarea(el, `{{${f}}}`);
              }}
              className="rounded-apple-sm border border-apple-blue/20 bg-apple-blue/5 px-2 py-0.5 text-apple-xs text-apple-blue transition-colors hover:bg-apple-blue/10"
              title={`Insert {{${f}}}`}
            >
              {'{{' + f + '}}'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Page ----------------------------- */
export default function NotificationsPage() {
  const rawParams = useParams() as { slug?: string } | null;
  const slug = (rawParams?.slug ?? '').toString();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [locationName, setLocationName] = useState('');
  const [confirmEmailEnabled, setConfirmEmailEnabled] = useState(false);
  const [confirmEmailTpl, setConfirmEmailTpl] = useState('');
  const [confirmSmsEnabled, setConfirmSmsEnabled] = useState(false);
  const [confirmSmsTpl, setConfirmSmsTpl] = useState('');
  const [changeEmailEnabled, setChangeEmailEnabled] = useState(false);
  const [changeEmailTpl, setChangeEmailTpl] = useState('');
  const [changeSmsEnabled, setChangeSmsEnabled] = useState(false);
  const [changeSmsTpl, setChangeSmsTpl] = useState('');
  const [emailNotifs, setEmailNotifs] = useState<ScheduledItem[]>([]);
  const [textNotifs, setTextNotifs] = useState<ScheduledItem[]>([]);

  useEffect(() => {
    let abort = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        setOkMsg(null);
        const res = await fetch(`/api/admin/locations/${slug}/notifications`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Load failed: ${res.status}`);
        const data: LoadedData = await res.json();
        if (abort) return;

        setLocationName(data.location.name);
        setConfirmEmailEnabled(!!data.confirmations.email.enabled);
        setConfirmEmailTpl(data.confirmations.email.template ?? '');
        setConfirmSmsEnabled(!!data.confirmations.sms.enabled);
        setConfirmSmsTpl(data.confirmations.sms.template ?? '');
        setChangeEmailEnabled(!!data.changeNotifications?.email?.enabled);
        setChangeEmailTpl(data.changeNotifications?.email?.template ?? '');
        setChangeSmsEnabled(!!data.changeNotifications?.sms?.enabled);
        setChangeSmsTpl(data.changeNotifications?.sms?.template ?? '');

        const emails = [...(data.notifications.emails ?? [])]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((n, idx) => ({ ...n, orderIndex: idx }));
        const texts = [...(data.notifications.texts ?? [])]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((n, idx) => ({ ...n, orderIndex: idx }));

        setEmailNotifs(emails);
        setTextNotifs(texts);
      } catch (e: any) {
        if (!abort) setError(e?.message ?? 'Error loading data');
      } finally {
        if (!abort) setLoading(false);
      }
    }
    if (slug) load();
    return () => { abort = true; };
  }, [slug]);

  async function onSave() {
    try {
      setSaving(true);
      setError(null);
      setOkMsg(null);
      const emails = emailNotifs.map((n, idx) => ({ ...n, orderIndex: idx }));
      const texts = textNotifs.map((n, idx) => ({ ...n, orderIndex: idx }));
      const body = {
        confirmations: {
          email: { enabled: confirmEmailEnabled, template: confirmEmailTpl },
          sms: { enabled: confirmSmsEnabled, template: confirmSmsTpl },
        },
        changeNotifications: {
          email: { enabled: changeEmailEnabled, template: changeEmailTpl },
          sms: { enabled: changeSmsEnabled, template: changeSmsTpl },
        },
        notifications: {
          emails: emails.map(stripClientOnlyFields),
          texts: texts.map(stripClientOnlyFields),
        },
      };
      const res = await fetch(`/api/admin/locations/${slug}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `Save failed: ${res.status}`);
      }
      setOkMsg('Saved!');
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function stripClientOnlyFields(n: ScheduledItem) {
    const { id, offsetHours, enabled, template, orderIndex } = n;
    return {
      id,
      offsetHours: Number(offsetHours || 0),
      enabled: !!enabled,
      template,
      orderIndex: Number(orderIndex || 0),
    };
  }

  function addEmail() {
    setEmailNotifs((prev) => [
      ...prev,
      { offsetHours: 24, enabled: true, template: '<p>Your reminder template…</p>', orderIndex: prev.length },
    ]);
  }

  function addText() {
    setTextNotifs((prev) => [
      ...prev,
      { offsetHours: 1, enabled: true, template: 'Your SMS reminder…', orderIndex: prev.length },
    ]);
  }

  function removeFrom(kind: 'email' | 'text', idx: number) {
    if (kind === 'email') {
      const next = emailNotifs.filter((_, i) => i !== idx).map((n, i) => ({ ...n, orderIndex: i }));
      setEmailNotifs(next);
    } else {
      const next = textNotifs.filter((_, i) => i !== idx).map((n, i) => ({ ...n, orderIndex: i }));
      setTextNotifs(next);
    }
  }

  function move(kind: 'email' | 'text', idx: number, dir: -1 | 1) {
    const list = kind === 'email' ? [...emailNotifs] : [...textNotifs];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    const reindexed = list.map((n, i) => ({ ...n, orderIndex: i }));
    kind === 'email' ? setEmailNotifs(reindexed) : setTextNotifs(reindexed);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Notifications</h1>
        <div className="text-apple-sm text-apple-text-tertiary">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <h1 className="text-apple-2xl font-semibold tracking-tight text-apple-text">Notifications</h1>
        <p className="mt-1 text-apple-base text-apple-text-secondary">{locationName}</p>
      </header>

      {error && (
        <div className="rounded-apple border border-apple-red/30 bg-apple-red/5 px-4 py-3 text-apple-sm text-apple-red">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-apple border border-apple-green/30 bg-apple-green/5 px-4 py-3 text-apple-sm text-apple-green">
          {okMsg}
        </div>
      )}

      {/* ─── Section 1: Booking Confirmations ─── */}
      <section className="card overflow-hidden">
        <div className="border-b border-apple-divider bg-apple-fill-secondary/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-apple-green/10">
              <svg className="h-4 w-4 text-apple-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
            <div>
              <h2 className="text-apple-lg font-semibold text-apple-text">Booking Confirmations</h2>
              <p className="text-apple-sm text-apple-text-secondary">Sent immediately when a new booking is created.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-apple-sm font-semibold text-apple-text">Email</label>
              <ToggleSwitch checked={confirmEmailEnabled} onChange={setConfirmEmailEnabled} />
            </div>
            <RichEmailEditor
              value={confirmEmailTpl}
              onChange={setConfirmEmailTpl}
              placeholder="Write the confirmation email…"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-apple-sm font-semibold text-apple-text">Text Message</label>
              <ToggleSwitch checked={confirmSmsEnabled} onChange={setConfirmSmsEnabled} />
            </div>
            <SmsTextArea value={confirmSmsTpl} onChange={setConfirmSmsTpl} />
          </div>
        </div>
      </section>

      {/* ─── Section 2: Change Notifications ─── */}
      <section className="card overflow-hidden">
        <div className="border-b border-apple-divider bg-apple-fill-secondary/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-apple-orange/10">
              <svg className="h-4 w-4 text-apple-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
            </span>
            <div>
              <h2 className="text-apple-lg font-semibold text-apple-text">Reservation Change Notifications</h2>
              <p className="text-apple-sm text-apple-text-secondary">Sent when an admin modifies a future reservation (time, bay, or details).</p>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-apple-sm font-semibold text-apple-text">Email</label>
              <ToggleSwitch checked={changeEmailEnabled} onChange={setChangeEmailEnabled} />
            </div>
            <RichEmailEditor
              value={changeEmailTpl}
              onChange={setChangeEmailTpl}
              placeholder="Write the change notification email…"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-apple-sm font-semibold text-apple-text">Text Message</label>
              <ToggleSwitch checked={changeSmsEnabled} onChange={setChangeSmsEnabled} />
            </div>
            <SmsTextArea value={changeSmsTpl} onChange={setChangeSmsTpl} />
          </div>
        </div>
      </section>

      {/* ─── Section 3: Scheduled Reminders ─── */}
      <section className="card overflow-hidden">
        <div className="border-b border-apple-divider bg-apple-fill-secondary/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-apple-blue/10">
              <svg className="h-4 w-4 text-apple-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
            <div>
              <h2 className="text-apple-lg font-semibold text-apple-text">Scheduled Reminders</h2>
              <p className="text-apple-sm text-apple-text-secondary">Sent a set number of hours before the booking starts.</p>
            </div>
          </div>
        </div>
        <div className="grid gap-8 p-6 lg:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-apple-sm font-semibold text-apple-text">Email Reminders</h3>
              <button
                onClick={addEmail}
                className="btn-secondary !px-3 !py-1.5 text-apple-xs"
              >
                + Add
              </button>
            </div>
            <div className="space-y-4">
              {emailNotifs.length === 0 && (
                <div className="rounded-apple border border-dashed border-apple-border p-4 text-center text-apple-sm text-apple-text-tertiary">
                  No email reminders configured.
                </div>
              )}
              {emailNotifs.map((n, idx) => (
                <NotifCard
                  key={`email-${idx}-${n.id ?? 'new'}`}
                  item={n}
                  rich
                  onChange={(changed) => {
                    setEmailNotifs((prev) => prev.map((p, i) => (i === idx ? changed : p)));
                  }}
                  onRemove={() => removeFrom('email', idx)}
                  onMoveUp={() => move('email', idx, -1)}
                  onMoveDown={() => move('email', idx, +1)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-apple-sm font-semibold text-apple-text">Text Reminders</h3>
              <button
                onClick={addText}
                className="btn-secondary !px-3 !py-1.5 text-apple-xs"
              >
                + Add
              </button>
            </div>
            <div className="space-y-4">
              {textNotifs.length === 0 && (
                <div className="rounded-apple border border-dashed border-apple-border p-4 text-center text-apple-sm text-apple-text-tertiary">
                  No text reminders configured.
                </div>
              )}
              {textNotifs.map((n, idx) => (
                <NotifCard
                  key={`text-${idx}-${n.id ?? 'new'}`}
                  item={n}
                  rich={false}
                  onChange={(changed) => {
                    setTextNotifs((prev) => prev.map((p, i) => (i === idx ? changed : p)));
                  }}
                  onRemove={() => removeFrom('text', idx)}
                  onMoveUp={() => move('text', idx, -1)}
                  onMoveDown={() => move('text', idx, +1)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10">
        <div className="inline-flex items-center gap-3 rounded-apple bg-white px-5 py-3 shadow-apple-lg">
          <button
            onClick={onSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <span className="text-apple-xs text-apple-text-tertiary">All sections saved together.</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Toggle Switch ------------------------- */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
        checked ? 'bg-apple-green' : 'bg-apple-border',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-apple transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

/* ------------------------- Notif Card ------------------------- */
function NotifCard({
  item,
  rich,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: ScheduledItem;
  rich: boolean;
  onChange: (n: ScheduledItem) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const smsRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="rounded-apple border border-apple-border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <ToggleSwitch checked={!!item.enabled} onChange={(v) => onChange({ ...item, enabled: v })} />
          <div className="flex items-center gap-2 text-apple-sm text-apple-text-secondary">
            <span>Hours before:</span>
            <input
              type="number"
              min={1}
              className="input !w-20 !py-1.5 text-center"
              value={item.offsetHours}
              onChange={(e) => onChange({ ...item, offsetHours: Number(e.target.value || 0) })}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onMoveUp}
            className="rounded-apple-sm border border-apple-border p-1.5 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
            title="Move up"
            type="button"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
          </button>
          <button
            onClick={onMoveDown}
            className="rounded-apple-sm border border-apple-border p-1.5 text-apple-text-tertiary transition-colors hover:bg-apple-fill-secondary hover:text-apple-text"
            title="Move down"
            type="button"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
          </button>
          <button
            onClick={onRemove}
            className="rounded-apple-sm border border-apple-red/30 p-1.5 text-apple-red/70 transition-colors hover:bg-apple-red/5 hover:text-apple-red"
            title="Remove"
            type="button"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
          </button>
        </div>
      </div>

      {rich ? (
        <RichEmailEditor
          value={item.template || ''}
          onChange={(html) => onChange({ ...item, template: html })}
          placeholder="Email reminder template…"
        />
      ) : (
        <div>
          <SmsToolbar textareaRef={smsRef} />
          <textarea
            ref={smsRef}
            className="input min-h-[120px] resize-y"
            placeholder="SMS reminder (plain text)…"
            value={item.template || ''}
            onChange={(e) => onChange({ ...item, template: e.target.value })}
          />
          <p className="mt-1.5 text-apple-xs text-apple-text-tertiary">
            Plain text. Merge fields like <code className="rounded bg-apple-fill-secondary px-1">{'{{firstName}}'}</code> will be replaced.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Helpers ---------------------------- */
function SmsTextArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <SmsToolbar textareaRef={ref} />
      <textarea
        ref={ref}
        className="input min-h-[140px] resize-y"
        placeholder="SMS template…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1.5 text-apple-xs text-apple-text-tertiary">
        Plain text. Same merge fields are supported.
      </p>
    </div>
  );
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}