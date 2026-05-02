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
