/**
 * Kisi door access integration.
 *
 * Outbound: create user, grant/revoke door group memberships, send mobile credential.
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
  return res.json();
}

// ---------- Users ----------
export async function kisiCreateUser(input: {
  email: string;
  name: string;
  phone?: string;
  organizationId?: number;
}): Promise<{ id: number }> {
  const data = await kisiFetch<{ id: number }>("/users", {
    method: "POST",
    body: JSON.stringify({
      user: {
        email: input.email,
        name: input.name,
        phone: input.phone,
        organization_id: input.organizationId,
      },
    }),
  });
  return { id: data.id };
}

/**
 * Trigger Kisi to email/SMS the mobile-credential setup link.
 * Returns the credential URL when the API exposes it (for forwarding via our channels).
 */
export async function kisiSendCredentialLink(userId: number): Promise<{ url: string | null }> {
  const data = await kisiFetch<any>(`/users/${userId}/send_invitation`, { method: "POST" });
  return { url: typeof data?.url === "string" ? data.url : null };
}

// ---------- Door groups ----------
export async function kisiAddUserToGroup(input: { userId: number; groupId: number }): Promise<void> {
  await kisiFetch(`/group_users`, {
    method: "POST",
    body: JSON.stringify({ group_user: { user_id: input.userId, group_id: input.groupId } }),
  });
}

export async function kisiRemoveUserFromGroup(input: { userId: number; groupId: number }): Promise<void> {
  // Kisi requires looking up the group_user record id first. Simplification: we'll
  // use the listing endpoint and delete by id.
  const list = await kisiFetch<any[]>(
    `/groups/${input.groupId}/group_users?user_id=${input.userId}`
  );
  for (const gu of list) {
    await kisiFetch(`/group_users/${gu.id}`, { method: "DELETE" });
  }
}

export async function kisiListUserGroups(userId: number): Promise<Array<{ id: number; name: string }>> {
  const data = await kisiFetch<any[]>(`/users/${userId}/groups`);
  return data.map((g: any) => ({ id: g.id, name: g.name }));
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
  return expected === input.signature;
}
