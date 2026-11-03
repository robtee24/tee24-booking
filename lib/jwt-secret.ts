// lib/jwt-secret.ts
//
// Shared guard for every HS256 signing key in the app. Callers pass their
// preferred env vars in fallback order (preserving the chains that existing
// tokens were signed with). A well-known dev default is only ever used outside
// production — in production a missing secret throws, because signing with a
// public string would let anyone mint sessions.
export function resolveJwtSecret(envNames: string[], devFallback: string): Uint8Array {
  for (const name of envNames) {
    const v = process.env[name];
    if (v) return new TextEncoder().encode(v);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`[jwt] none of ${envNames.join(" / ")} is set; refusing to use a default secret in production`);
  }
  console.warn(`[jwt] none of ${envNames.join(" / ")} is set — using insecure dev fallback`);
  return new TextEncoder().encode(devFallback);
}
