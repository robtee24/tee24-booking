'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onCmd('bold')} className="rounded border px-2 py-1 hover:bg-gray-50">B</button>
        <button type="button" onClick={() => onCmd('italic')} className="rounded border px-2 py-1 italic hover:bg-gray-50">I</button>
        <button type="button" onClick={() => onCmd('underline')} className="rounded border px-2 py-1 underline hover:bg-gray-50">U</button>
      </div>
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onCmd('ul')} className="rounded border px-2 py-1 hover:bg-gray-50">• List</button>
        <button type="button" onClick={() => onCmd('ol')} className="rounded border px-2 py-1 hover:bg-gray-50">1. List</button>
      </div>
      <button type="button" onClick={onLink} className="rounded border px-2 py-1 hover:bg-gray-50">Link</button>
      <button type="button" onClick={onClear} className="rounded border px-2 py-1 hover:bg-gray-50">Clear formatting</button>
      <div className="ml-auto inline-flex items-center gap-1">
        <span className="text-gray-500">Merge:</span>
        <div className="flex flex-wrap gap-1">
          {mergeFieldKeys.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onMerge(f)}
              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
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
        className="min-h-[160px] w-full rounded-md border p-3 prose max-w-none focus:outline-none"
        contentEditable
        role="textbox"
        aria-label="Email template editor"
        data-placeholder={placeholder}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        suppressContentEditableWarning
        style={{ whiteSpace: 'pre-wrap' }}
      />
      <p className="mt-1 text-xs text-gray-500">
        This editor stores <strong>HTML</strong>. Merge fields are inserted like <code>{'{{firstName}}'}</code>.
      </p>
      <p className="mt-1 text-xs text-gray-400">
        Aliases: <code>{'{{startTime}}'}</code> → <code>{'{{start}}'}</code>, <code>{'{{endTime}}'}</code> → <code>{'{{end}}'}</code>
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
    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        className="rounded border px-2 py-1 hover:bg-gray-50"
        onClick={() => {
          const el = textareaRef.current;
          if (!el) return;
          insertAtCaret_textarea(el, '\n');
        }}
      >
        New line
      </button>
      <div className="ml-auto inline-flex items-center gap-1">
        <span className="text-gray-500">Merge:</span>
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
              className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
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
  const [emailNotifs, setEmailNotifs] = useState<ScheduledItem[]>([]);
  const [textNotifs, setTextNotifs] = useState<ScheduledItem[]>([]);

  const dirty = useMemo(() => true, [
    confirmEmailEnabled,
    confirmEmailTpl,
    confirmSmsEnabled,
    confirmSmsTpl,
    emailNotifs,
    textNotifs,
  ]);

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
        <h1 className="text-xl font-semibold">Notifications</h1>
        <div className="text-gray-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Notifications</h1>
        <p className="text-sm text-gray-600">Location: {locationName}</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {okMsg}
        </div>
      )}

      {/* Confirmations */}
      <section className="rounded-2xl border bg-white">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold">Confirmations (sent immediately on booking)</h2>
          <p className="text-sm text-gray-600">One email + one text per booking.</p>
        </div>
        <div className="grid gap-6 p-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium">Email confirmation</label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={confirmEmailEnabled}
                  onChange={(e) => setConfirmEmailEnabled(e.target.checked)}
                />
                Enabled
              </label>
            </div>
            <RichEmailEditor
              value={confirmEmailTpl}
              onChange={setConfirmEmailTpl}
              placeholder="Write the email your guests will receive…"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-medium">Text confirmation</label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={confirmSmsEnabled}
                  onChange={(e) => setConfirmSmsEnabled(e.target.checked)}
                />
                Enabled
              </label>
            </div>
            <SmsTextArea value={confirmSmsTpl} onChange={setConfirmSmsTpl} />
            <p className="text-xs text-gray-500">SMS is plain text. The same merge fields are supported.</p>
          </div>
        </div>
      </section>

      {/* Scheduled notifications */}
      <section className="rounded-2xl border bg-white">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold">Scheduled Notifications (before booking)</h2>
          <p className="text-sm text-gray-600">
            Add any number of reminders. <code>offsetHours</code> is how many hours <em>before</em> the booking to send.
          </p>
        </div>
        <div className="grid gap-8 p-4 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">Email reminders</h3>
              <button
                onClick={addEmail}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                + Add email reminder
              </button>
            </div>
            <div className="space-y-4">
              {emailNotifs.length === 0 && (
                <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
                  No email reminders yet.
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
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">Text reminders</h3>
              <button
                onClick={addText}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                + Add text reminder
              </button>
            </div>
            <div className="space-y-4">
              {textNotifs.length === 0 && (
                <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
                  No text reminders yet.
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

      <div className="sticky bottom-4 z-10 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && <span className="text-xs text-gray-500">Changes are saved in bulk.</span>}
      </div>
    </div>
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
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!item.enabled}
              onChange={(e) => onChange({ ...item, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span>Hours before:</span>
            <input
              type="number"
              min={1}
              className="w-24 rounded border px-2 py-1"
              value={item.offsetHours}
              onChange={(e) => onChange({ ...item, offsetHours: Number(e.target.value || 0) })}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onMoveUp}
            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
            title="Move up"
            type="button"
          >
            Up
          </button>
          <button
            onClick={onMoveDown}
            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
            title="Move down"
            type="button"
          >
            Down
          </button>
          <button
            onClick={onRemove}
            className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            title="Remove"
            type="button"
          >
            Remove
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
            className="min-h-[120px] w-full rounded border p-2"
            placeholder="SMS reminder (plain text)…"
            value={item.template || ''}
            onChange={(e) => onChange({ ...item, template: e.target.value })}
          />
          <p className="mt-1 text-xs text-gray-500">
            SMS is plain text. Merge fields like <code>{'{{firstName}}'}</code> will be replaced.
          </p>
        </div>
      )}

      <div className="mt-2 text-xs text-gray-500">
        Order: <code>{item.orderIndex}</code>
      </div>
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
        className="min-h-[140px] w-full rounded-md border p-2"
        placeholder="SMS template…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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