/**
 * Kisi door access integration.
 *
 * Outbound: ensure member, grant/revoke door-group role assignments (Kisi emails the mobile credential).
 * Inbound webhooks: door unlock events → fed to Visit dedupe pipeline.
 *
 * Env:
 *   - KISI_API_KEY        - personal API key (server-to-server)
 *   - KISI_WEBHOOK_SECRET - HMAC secret for webhook verification
 *   - KISI_PLACE_ID       - default place id (org-wide; per-location mapping in Settings)
 */

const BASE = "https://api.kisi.io";

function getApiKey(): string | undefined {
  return process.env.KISI_API_KEY;
}

async function kisiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getApiKey();
  if (!key) throw new Error("[kisi] KISI_API_KEY missing");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `KISI-LOGIN ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[kisi] ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null as T;
  const body = await res.text();
  return (body ? JSON.parse(body) : null) as T;
}

// ---------- Users / members ----------
//
// Kisi's current API (https://api.kisi.io/docs):
//   • organization members      → /members           (a Member wraps a User; `user_id` is what
//                                                      role assignments and shares reference)
//   • group access for a user   → /role_assignments  (role_id "group_basic", applies_to Group)
//   • legacy email shares       → /shares            (how GymDesk granted access; still valid)
// There is no /group_users or /users/{id}/groups endpoint.

export type KisiMember = { id: number; user_id: number | null; email: string | null; name: string | null; access_enabled?: boolean | null };

function memberOf(m: any): KisiMember {
  return { id: m.id, user_id: m.user_id ?? m.user?.id ?? null, email: m.user?.email ?? m.email ?? null, name: m.name ?? m.user?.name ?? null, access_enabled: m.access_enabled ?? null };
}

/** Exact-match lookup of an organization member by email (case-insensitive). */
export async function kisiFindMemberByEmail(email: string): Promise<KisiMember | null> {
  const q = email.trim().toLowerCase();
  if (!q) return null;
  const list = await kisiFetch<any[]>(`/members?query=${encodeURIComponent(q)}&limit=50`);
  const hit = list.find((m) => (m.user?.email ?? m.email ?? "").toLowerCase() === q);
  return hit ? memberOf(hit) : null;
}

/** Look up the organization member record for a Kisi *user id* (falls back to email). */
export async function kisiFindMemberByUserId(userId: number, email?: string | null): Promise<KisiMember | null> {
  const list = await kisiFetch<any[]>(`/members?user_id=${userId}&limit=50`).catch(() => [] as any[]);
  const hit = (list ?? []).find((m) => (m.user_id ?? m.user?.id) === userId);
  if (hit) return memberOf(hit);
  return email ? kisiFindMemberByEmail(email) : null;
}

/** Every organization member (paginated). Used by reconciliation to find orphans. */
export async function kisiListAllMembers(): Promise<KisiMember[]> {
  const out: KisiMember[] = [];
  const limit = 100;
  for (let offset = 0; offset < 20_000; offset += limit) {
    const page = await kisiFetch<any[]>(`/members?limit=${limit}&offset=${offset}`);
    if (!page?.length) break;
    out.push(...page.map(memberOf));
    if (page.length < limit) break;
  }
  return out;
}

/**
 * Remove a person from the Kisi organization entirely. Deleting the organization
 * member revokes every role assignment, share and mobile credential for that
 * person at once. 404 is treated as already gone.
 */
export async function kisiDeleteMember(input: { userId: number; email?: string | null }): Promise<{ deleted: boolean; kisiMemberId: number | null }> {
  const m = await kisiFindMemberByUserId(input.userId, input.email);
  if (!m) return { deleted: false, kisiMemberId: null };
  await kisiFetch(`/members/${m.id}`, { method: "DELETE" }).catch((e) => { if (!/\(404\)/.test(String(e))) throw e; });
  return { deleted: true, kisiMemberId: m.id };
}

/**
 * Ensure a Kisi organization member exists for this email and return the *user id*
 * (the id used by role assignments / shares). Idempotent: reuses an existing member.
 * Kisi emails the mobile-credential invitation itself when the member is created.
 */
export async function kisiCreateUser(input: {
  email: string;
  name: string;
  phone?: string;
  organizationId?: number;
}): Promise<{ id: number; memberId: number | null }> {
  const existing = await kisiFindMemberByEmail(input.email);
  if (existing) return { id: existing.user_id ?? existing.id, memberId: existing.id };
  const data = await kisiFetch<any>("/members", {
    method: "POST",
    body: JSON.stringify({
      member: {
        email: input.email.trim().toLowerCase(),
        name: input.name,
        send_emails: true,
        access_enabled: true,
      },
    }),
  });
  return { id: data.user_id ?? data.user?.id ?? data.id, memberId: data.id ?? null };
}

/**
 * Kisi has no separate "send credential link" endpoint: the invitation email goes out
 * when the member is created / first granted access (notify: true). Kept for callers.
 */
export async function kisiSendCredentialLink(_userId: number): Promise<{ url: string | null }> {
  return { url: null };
}

// ---------- Door groups ----------

type RoleAssignment = { id: number; role_id: string; applies_to_type: string; applies_to_id: number; applies_to?: { id: number; name: string } | null; assignee_type: string; assignee_id: number };

async function listGroupRoleAssignments(userId: number, groupId?: number): Promise<RoleAssignment[]> {
  const qs = new URLSearchParams({ user_id: String(userId), applies_to_type: "Group", limit: "100" });
  if (groupId) qs.set("group_id", String(groupId));
  return kisiFetch<RoleAssignment[]>(`/role_assignments?${qs}`);
}

async function listGroupShares(userId: number, groupId: number): Promise<Array<{ id: number }>> {
  return kisiFetch<Array<{ id: number }>>(`/shares?user_id=${userId}&group_id=${groupId}&limit=100`).catch(() => []);
}

/** Grant a user access via a door group. Idempotent (skips if an assignment already exists). */
export async function kisiAddUserToGroup(input: { userId: number; groupId: number; notify?: boolean }): Promise<void> {
  const existing = await listGroupRoleAssignments(input.userId, input.groupId);
  if (existing.some((ra) => ra.applies_to_id === input.groupId)) return;
  await kisiFetch(`/role_assignments`, {
    method: "POST",
    body: JSON.stringify({
      role_assignment: {
        applies_to_type: "Group",
        applies_to_id: input.groupId,
        assignee_type: "User",
        assignee_id: input.userId,
        role_id: "group_basic",
        notify: input.notify ?? true,
      },
    }),
  });
}

/** Revoke a user's access to a door group — removes role assignments *and* legacy shares. */
export async function kisiRemoveUserFromGroup(input: { userId: number; groupId: number }): Promise<void> {
  const ras = await listGroupRoleAssignments(input.userId, input.groupId);
  for (const ra of ras) {
    if (ra.applies_to_id !== input.groupId) continue;
    await kisiFetch(`/role_assignments/${ra.id}`, { method: "DELETE" }).catch((e) => { if (!/\(404\)/.test(String(e))) throw e; });
  }
  for (const sh of await listGroupShares(input.userId, input.groupId)) {
    await kisiFetch(`/shares/${sh.id}`, { method: "DELETE" }).catch((e) => { if (!/\(404\)/.test(String(e))) throw e; });
  }
}

export async function kisiListUserGroups(userId: number): Promise<Array<{ id: number; name: string }>> {
  const ras = await listGroupRoleAssignments(userId);
  const seen = new Map<number, string>();
  for (const ra of ras) if (!seen.has(ra.applies_to_id)) seen.set(ra.applies_to_id, ra.applies_to?.name ?? String(ra.applies_to_id));
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ---------- Places / Locks (doors) ----------
export type KisiPlace = {
  id: number;
  name: string;
  address?: string | null;
  time_zone?: string | null;
  locks_count?: number | null;
};

export type KisiLock = {
  id: number;
  name: string;
  description?: string | null;
  configured: boolean;
  online: boolean | null;
  open?: boolean | null;
  unlocked: boolean;
  locked_down: boolean;
  locked_down_since?: string | null;
  place_id: number | null;
  place?: { id: number; name: string } | null;
  updated_at?: string;
};

export function kisiConfigured(): boolean {
  return Boolean(getApiKey());
}

export async function kisiListPlaces(): Promise<KisiPlace[]> {
  const out: KisiPlace[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await kisiFetch<KisiPlace[]>(`/places?limit=100&offset=${offset}`);
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

export async function kisiListLocks(): Promise<KisiLock[]> {
  const out: KisiLock[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await kisiFetch<KisiLock[]>(`/locks?limit=100&offset=${offset}`);
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

export async function kisiGetLock(id: number): Promise<KisiLock> {
  return kisiFetch<KisiLock>(`/locks/${id}`);
}

/** Remote unlock. Kisi answers `{ message: "Unlocked!" }` on success. */
export async function kisiUnlockLock(id: number): Promise<{ message: string }> {
  return kisiFetch<{ message: string }>(`/locks/${id}/unlock`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ---------- Events (unlock history) ----------
export type KisiEvent = {
  uuid: string;
  type: string; // e.g. "lock.unlock"
  action?: string;
  actor_type: string | null;
  actor_id: number | null;
  actor_name: string | null;
  actor_email: string | null;
  authenticated_by_type?: string | null;
  object_type: string; // "Lock"
  object_id: number;
  object_name: string;
  created_at: string;
  success: boolean;
  place_id: number | null;
  organization_id?: number;
  code?: string | null;
  error_code?: string | null;
};

type EventSet = {
  id: number;
  status: "in_progress" | "finished" | "failed";
  events?: KisiEvent[];
  cursor?: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch successful unlock events in [from, to] via the event-set API
 * (POST /event_sets, then page GET /event_sets/{id}?cursor=...).
 * Interval cannot exceed 90 days; callers should chunk.
 */
export async function kisiListUnlockEvents(input: {
  from: Date;
  to: Date;
  eventType?: string;
  maxEvents?: number;
}): Promise<KisiEvent[]> {
  const interval = `${input.from.toISOString()}/${input.to.toISOString()}`;
  const created = await kisiFetch<EventSet>(`/event_sets`, {
    method: "POST",
    body: JSON.stringify({
      event_set: {
        interval,
        event_type: input.eventType ?? "lock.unlock",
        event_success: true,
      },
    }),
  });

  const max = input.maxEvents ?? 5000;
  const events: KisiEvent[] = [];
  let set = created;
  // Wait for the set to be ready.
  for (let i = 0; i < 20 && set.status === "in_progress"; i++) {
    await sleep(1000);
    set = await kisiFetch<EventSet>(`/event_sets/${created.id}?limit=200`);
  }
  if (set.status === "failed") throw new Error("[kisi] event set failed");
  events.push(...(set.events ?? []));

  let cursor = set.cursor ?? null;
  while (cursor && events.length < max) {
    await sleep(250); // stay under the 5 req/s limit
    const page = await kisiFetch<EventSet>(
      `/event_sets/${created.id}?limit=200&cursor=${encodeURIComponent(cursor)}`
    );
    const batch = page.events ?? [];
    if (batch.length === 0) break;
    events.push(...batch);
    cursor = page.cursor ?? null;
  }
  return events.slice(0, max);
}

// ---------- Webhook verification ----------
import crypto from "crypto";

export function verifyKisiSignature(input: {
  body: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = input.secret ?? process.env.KISI_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[kisi] KISI_WEBHOOK_SECRET missing — accepting webhook unverified");
    return true;
  }
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(input.body);
  const expected = hmac.digest("hex");
  // Kisi sends `X-Signature: sha256=<hex mac>`; tolerate a bare hex too.
  const provided = input.signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}
