/**
 * Visit-quota enforcement mode for limited plans (e.g. The Noonan, 3 visits/month).
 *
 * The Tee24 app always checks the allowance before unlocking. Members who still
 * unlock with the Kisi app bypass that check, so Tee24 can also take them out
 * of the Kisi door group once their last allowed day is over and put them back
 * when the period rolls over. `VISIT_QUOTA_MODE` controls how far that goes:
 *
 *   off      – nothing beyond the in-app unlock check
 *   notify   – text/email the member when they use their last visit; Kisi untouched (default)
 *   enforce  – notify + remove from the Kisi door group at the end of that local
 *              day, re-add automatically when the period rolls over
 *
 * Change the variable on Vercel and redeploy to switch modes.
 */
export type VisitQuotaMode = "off" | "notify" | "enforce";

export function visitQuotaMode(): VisitQuotaMode {
  const v = (process.env.VISIT_QUOTA_MODE ?? "notify").trim().toLowerCase();
  if (v === "enforce" || v === "enforced" || v === "on") return "enforce";
  if (v === "off" || v === "0" || v === "false" || v === "none") return "off";
  return "notify";
}

export function visitQuotaRevokesAccess(): boolean {
  return visitQuotaMode() === "enforce";
}
