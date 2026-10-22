/**
 * Migration freeze — while GymDesk is still the system of record (members,
 * billing, Kisi shares), Tee24 holds a mirror of the data but must not act on
 * it. Set `MIGRATION_FREEZE=1` to keep Tee24 passive:
 *
 *   • AccessSync never calls Kisi (no user creation, no group changes,
 *     no credential emails) and never flips the local mirror.
 *   • Recurring billing crons (invoice generation, dunning retries,
 *     upcoming-payment reminders) and the nightly access reconciliation
 *     are skipped.
 *
 * Flip the variable off (or remove it) at cutover and redeploy.
 */
export function isMigrationFrozen(): boolean {
  const v = (process.env.MIGRATION_FREEZE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export const MIGRATION_FREEZE_SKIP = "MIGRATION_FREEZE is on — GymDesk is still the system of record";
