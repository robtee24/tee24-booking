# Open decisions — recorded defaults

The original spec carved out eight open decisions to resolve before launch.
Each one is captured here with the implemented default. Any change just needs
to be reflected in the linked code, the audit will pick it up.

| # | Decision | Default | Code reference |
|---|----------|---------|----------------|
| 1 | Member portal magic-link default | **Magic link only** for first launch (passwordless). Phone OTP added later. | `app/api/portal/auth/magic/route.ts` |
| 2 | Family-bundle pricing model | **Per-seat with primary discount** — primary pays full plan price, additional family members get a configurable percent discount (default 20%). | `services/family.service.ts`, `services/membership.service.ts` |
| 3 | Late-fee defaults | **No automatic late fee.** Past-due invoices are flagged + retry dunning runs daily for 7 days, then a manual collection task is created. | `services/billing.service.ts`, `app/api/cron/route.ts` |
| 4 | Comp-membership accounting treatment | **Recognized as zero revenue / "Comp" in the revenue report**, separate column. Comped invoices still create a `Charge` row with `amountCents = 0` so attendance + reporting work. | `services/billing.service.ts` |
| 5 | Minor remote signing | **Parent/guardian co-sign required** — when `Member.dob` makes the member < 18, document signing flow requires a second signature from a guardian email captured at signup. | `services/document.service.ts` |
| 6 | Referral payout approval flow | **Owner approval required** for any monthly batch over $1,000 total or any single payout over $500. Below thresholds: auto-send. | `services/referral.service.ts`, `app/api/admin/referrals/send-payouts/route.ts` |
| 7 | Honor existing Gymdesk signed docs | **Yes**, with audit trail. Imported assignments keep `pdf_url` and are tagged `import-source: gymdesk`. New versions are not auto-required. | `scripts/migration/import.ts`, `services/document.service.ts` |
| 8 | Multi-org boundary | **Strict org isolation** — every query is scoped by `organizationId`. The single exception is the org-wide Franchise dashboard for the org owner. | `lib/access.ts`, `app/admin/franchise/*` |

These defaults can be revisited at any point — they're values, not architecture.
