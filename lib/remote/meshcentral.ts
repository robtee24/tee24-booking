// lib/remote/meshcentral.ts
import crypto from "crypto";

/**
 * Remote support for bay computers via MeshCentral (Apache-2.0, self-hosted).
 *
 * Why MeshCentral: admins remote in from a browser tab (desktop or phone) with
 * no client install; agents on the bay PCs dial out, so no port-forwarding at
 * the sims; unattended access, file transfer, terminal and remote reboot are
 * built in; and login tokens let the Tee24 admin open a session in one click.
 *
 * Server env (Vercel):
 *   MESHCENTRAL_URL              https://mesh.tee24.golf
 *   MESHCENTRAL_MESH_ID          device-group id the bay agents join (Settings -> Device Group -> "Mesh ID", starts with "mesh//")
 *   MESHCENTRAL_LOGIN_TOKEN_KEY  output of `node node_modules/meshcentral --logintokenkey` on the Mesh server
 *   MESHCENTRAL_ADMIN_USER       Mesh account the Tee24 admin console acts as (default "tee24")
 *   MESHCENTRAL_DOMAIN           Mesh domain id (default "" = root domain)
 *
 * MeshCentral config.json must have:  "settings": { "allowLoginToken": true, "allowFraming": true }
 */

export type RemoteConfig = {
  url: string;
  meshId: string | null;
  loginTokenKey: string | null;
  adminUser: string;
  domain: string;
};

export function getRemoteConfig(): RemoteConfig | null {
  const url = (process.env.MESHCENTRAL_URL || "").trim().replace(/\/+$/, "");
  if (!url) return null;
  return {
    url,
    meshId: (process.env.MESHCENTRAL_MESH_ID || "").trim() || null,
    loginTokenKey: (process.env.MESHCENTRAL_LOGIN_TOKEN_KEY || "").trim() || null,
    adminUser: (process.env.MESHCENTRAL_ADMIN_USER || "tee24").trim(),
    domain: (process.env.MESHCENTRAL_DOMAIN || "").trim(),
  };
}

/** Public info the kiosk needs to install the agent (no secrets). */
export function remoteInfoForKiosk(): { provider: "meshcentral"; serverUrl: string; agentUrl: string | null } | null {
  const cfg = getRemoteConfig();
  if (!cfg) return null;
  // Agent download: id=4 is the Windows x64 agent. installflags=0 = full install allowed.
  const agentUrl = cfg.meshId
    ? `${cfg.url}/meshagents?id=4&meshid=${encodeURIComponent(cfg.meshId.replace(/^mesh\/\//, ""))}&installflags=0`
    : null;
  return { provider: "meshcentral", serverUrl: cfg.url, agentUrl };
}

/**
 * Normalise a node id reported by the agent to MeshCentral's `node//<id>` form.
 * `meshagent -nodeid` prints base64 (sometimes hex); Mesh URL ids use
 * base64 with '+' -> '@' and '/' -> '$'.
 */
export function normalizeNodeId(raw: string): string | null {
  let s = (raw || "").trim();
  if (!s) return null;
  if (s.startsWith("node//")) s = s.slice(6);
  if (/^[0-9a-fA-F]{96}$/.test(s)) s = Buffer.from(s, "hex").toString("base64");
  s = s.replace(/\+/g, "@").replace(/\//g, "$").replace(/=+$/, "");
  return `node//${s}`;
}

/**
 * One-click URL to the device's remote desktop. If a login-token key is
 * configured, the URL signs the admin in automatically (token valid ~60 min);
 * otherwise Mesh prompts for its own credentials.
 */
export function deviceSessionUrl(nodeId: string, opts?: { view?: "desktop" | "terminal" | "files" | "details" }): string | null {
  const cfg = getRemoteConfig();
  if (!cfg) return null;
  const node = normalizeNodeId(nodeId);
  if (!node) return null;
  const viewmode = { desktop: 11, terminal: 12, files: 13, details: 10 }[opts?.view ?? "desktop"];
  const params = new URLSearchParams({ gotonode: node, viewmode: String(viewmode), hide: "16" });
  if (cfg.loginTokenKey) {
    const userid = `user/${cfg.domain}/${cfg.adminUser}`;
    params.set("login", encodeLoginToken(userid, cfg.loginTokenKey));
  }
  return `${cfg.url}/?${params.toString()}`;
}

/**
 * MeshCentral login cookie: AES-256-GCM over JSON {u: userid, a: 3, time},
 * iv(12) + ciphertext + tag(16), base64 with '+'->'@' and '/'->'$'.
 * Mirrors meshcentral/common.js encodeCookie().
 */
export function encodeLoginToken(userid: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex").subarray(0, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify({ u: userid, a: 3, time: Math.floor(Date.now() / 1000) });
  const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString("base64").replace(/\+/g, "@").replace(/\//g, "$");
}
