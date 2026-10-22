/**
 * Per-location Square account connection (Admin → Billing → Settings → Square).
 *
 * Secrets (access token, webhook signing key) are encrypted with lib/secrets.ts
 * before they touch the database and are never returned to the browser — the
 * UI only ever sees a "••••1234" hint.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { invalidateSquareCreds, normalizeSquareEnv, SquareApiError, squareListLocations, type SquareEnv, type SquareLocationInfo } from "@/lib/square";

export type VerifyTokenInput = {
  locationId: string;
  env: SquareEnv;
  /** New token to test; when omitted the stored token for this location is used. */
  accessToken?: string | null;
};

/**
 * Validate an access token by listing the Square locations it can see.
 * Returns the list so the admin can pick which Square location to bill through.
 */
export async function verifySquareToken(input: VerifyTokenInput): Promise<{ locations: SquareLocationInfo[] }> {
  const token = (input.accessToken ?? "").trim() || (await storedToken(input.locationId));
  if (!token) throw new Error("Enter a Square access token first");
  try {
    const locations = await squareListLocations({ accessToken: token, env: input.env });
    if (locations.length === 0) throw new Error("This token can't see any Square locations. Check the token and the environment (production vs sandbox).");
    return { locations };
  } catch (e) {
    if (e instanceof SquareApiError && (e.status === 401 || e.status === 403)) {
      throw new Error(`Square rejected the token (${e.code ?? e.status}). Make sure it's a ${input.env} token with MERCHANT_PROFILE_READ, PAYMENTS_WRITE, CUSTOMERS_WRITE and ITEMS/ORDERS permissions.`);
    }
    throw e;
  }
}

export type SaveSquareConnectionInput = {
  locationId: string;
  env: string;
  applicationId: string | null;
  squareLocationId: string;
  /** Omit / empty to keep the stored token. */
  accessToken?: string | null;
  /** Omit / empty to keep the stored key; `clearWebhookKey` removes it. */
  webhookSignatureKey?: string | null;
  clearWebhookKey?: boolean;
  actorId?: string | null;
};

export async function saveSquareConnection(input: SaveSquareConnectionInput) {
  const prisma = getPrisma();
  const env = normalizeSquareEnv(input.env);
  const loc = await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true, organizationId: true, squareAccessTokenEnc: true, squareLocationId: true, squareEnv: true } });
  if (!loc) throw new Error("Location not found");

  const newToken = (input.accessToken ?? "").trim();
  const token = newToken || decryptSecret(loc.squareAccessTokenEnc);
  if (!token) throw new Error("A Square access token is required");
  const squareLocationId = input.squareLocationId.trim();
  if (!squareLocationId) throw new Error("Choose the Square location to bill through");

  // Prove the token works and the chosen Square location belongs to it.
  const { locations } = await verifySquareToken({ locationId: loc.id, env, accessToken: token });
  const chosen = locations.find((l) => l.id === squareLocationId);
  if (!chosen) throw new Error("That Square location isn't visible to this token. Pick one of the locations returned by the token.");
  if (chosen.status && chosen.status !== "ACTIVE") throw new Error(`Square location "${chosen.name}" is ${chosen.status.toLowerCase()} in Square.`);

  const data: Record<string, unknown> = {
    squareEnv: env,
    squareApplicationId: (input.applicationId ?? "").trim() || null,
    squareLocationId,
    squareMerchantName: chosen.businessName ?? chosen.name,
    squareConnectedAt: new Date(),
  };
  if (newToken) data.squareAccessTokenEnc = encryptSecret(newToken);
  const newKey = (input.webhookSignatureKey ?? "").trim();
  if (input.clearWebhookKey) data.squareWebhookSignatureKeyEnc = null;
  else if (newKey) data.squareWebhookSignatureKeyEnc = encryptSecret(newKey);

  await prisma.location.update({ where: { id: loc.id }, data });
  invalidateSquareCreds(loc.id);

  void audit({
    organizationId: loc.organizationId,
    actorId: input.actorId ?? undefined,
    action: "billing.square-connect",
    entityType: "Location",
    entityId: loc.id,
    before: { squareLocationId: loc.squareLocationId, squareEnv: loc.squareEnv, hadToken: Boolean(loc.squareAccessTokenEnc) },
    after: { squareLocationId, squareEnv: env, merchant: chosen.businessName ?? chosen.name, tokenRotated: Boolean(newToken), webhookKeyChanged: Boolean(newKey || input.clearWebhookKey) },
  });
  return { merchantName: chosen.businessName ?? chosen.name, squareLocation: chosen };
}

export async function disconnectSquare(locationId: string, actorId?: string | null) {
  const prisma = getPrisma();
  const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, organizationId: true, squareLocationId: true, squareEnv: true } });
  if (!loc) throw new Error("Location not found");
  await prisma.location.update({
    where: { id: locationId },
    data: {
      squareEnv: null,
      squareApplicationId: null,
      squareLocationId: null,
      squareAccessTokenEnc: null,
      squareWebhookSignatureKeyEnc: null,
      squareMerchantName: null,
      squareConnectedAt: null,
    },
  });
  invalidateSquareCreds(locationId);
  void audit({
    organizationId: loc.organizationId,
    actorId: actorId ?? undefined,
    action: "billing.square-disconnect",
    entityType: "Location",
    entityId: loc.id,
    before: { squareLocationId: loc.squareLocationId, squareEnv: loc.squareEnv },
  });
}

async function storedToken(locationId: string): Promise<string | null> {
  const loc = await getPrisma().location.findUnique({ where: { id: locationId }, select: { squareAccessTokenEnc: true } });
  return decryptSecret(loc?.squareAccessTokenEnc);
}
