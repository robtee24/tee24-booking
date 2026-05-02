# Gymdesk → Tee24 Migration Tooling

This directory contains the tooling for migrating an existing Gymdesk
installation into the Tee24 gym management module suite.

## Overview

Migration runs in five sequential phases, all idempotent:

1. **Discovery** — pull a full Gymdesk export and a Square inventory.
2. **Map & dedupe** — apply the field mapping (`mappings.ts`) and resolve
   duplicates by email + phone + fuzzy-name match.
3. **Dry-run import** — load to staging and produce a validation report.
4. **Parallel sync** — keep Tee24 in read-only sync with Gymdesk for the 2 weeks
   before cutover (run `sync.ts` on a cron).
5. **Cutover** — freeze writes in Gymdesk, run a final delta import, flip
   public-form/portal DNS, and start the 2-week hyper-care window.

## Required inputs

A Gymdesk export with the following CSV files (configurable in `mappings.ts`):

| File                    | Maps to                            |
| ----------------------- | ---------------------------------- |
| `members.csv`           | `Member`, `EmergencyContact`       |
| `memberships.csv`       | `MembershipPlan`                   |
| `subscriptions.csv`     | `MembershipSubscription`           |
| `payments.csv`          | `Invoice`, `Charge`                |
| `attendance.csv`        | `Visit`                            |
| `documents.csv`         | `Document`, `DocumentAssignment`   |
| `tags.csv`              | `Tag`, `MemberTag`                 |
| `automations.csv`       | `Automation` + `AutomationStep`    |
| `signup_forms.csv`      | `SignupForm`                       |

## Commands

```bash
# Validate inputs without writing to DB.
npm run migration:dry-run -- --input ./exports/gymdesk-2026-04-30

# Full import (writes to staging).
npm run migration:import -- --input ./exports/gymdesk-2026-04-30 --target staging

# Delta sync (cron, every 15 min during the parallel window).
npm run migration:sync

# Final cutover delta + status report.
npm run migration:cutover -- --input ./exports/gymdesk-cutover
```

All commands honor `DATABASE_URL` and require `MIGRATION_BATCH_SIZE`
(defaults to 500).

## Idempotency

Every imported row carries a `gymDeskId` (or equivalent) on the corresponding
Tee24 model. Re-runs upsert on that key, so partial imports + retries are safe.

## Validation report

The dry-run produces `validation-report.html` summarizing:

- Counts in vs. counts out (per entity)
- Orphan FK references (e.g. payments without a member)
- Square subscription matches (% of `MembershipSubscription` rows that mapped
  to an existing `squareSubscriptionId`)
- Dedupe collisions (multiple Gymdesk rows merged into one Tee24 member)
- Per-member document signature integrity (PDF hash present)
