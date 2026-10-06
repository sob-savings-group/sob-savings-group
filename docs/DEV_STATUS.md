# SOB Lifetime Platform — dev status (branch `dev`; `main`/production untouched)

## Run
- `npm test` — core, workflow, backend (mock Sheets + bundled .gs sandbox), client/report tests
- `node e2e/smoke.js` — Playwright desktop + mobile demo-mode E2E
- `npm run build` — bundles src/ into `dist/Code_Ledger.gs` (Apps Script)
- `node build/dry-run.js <legacy.json>` — migration verification report
- UI: serve repo root, open `/app/index.html` (demo mode until `app/config.js` has URLs)

## Still blocked (SOB decisions — nothing invented)
1 profit formula · 2 qualifying savings · 3 guarantor sufficiency · 7 Interest Receivable basis (shown "provisional")
Also open: 4 historical depth · 5 Committee permissions · 6 approval separation scope
New, found during build: subscription accounting (income vs part of savings) · savings of loan-holders at share-out ·
repayment allocation order (interest vs principal) · whether guarantor cover may be split across guarantors.

## Before any production release
- Server-side authorisation: today roles are enforced in the client; the Sheet endpoint trusts anyone holding the ledger key.
  Needs per-user tokens/role checks in Code_Ledger.gs before go-live.
- Real disbursement dates for the 10 seed loans (all 2025-12-21); legacy header savings mismatch.
- Deploy Code_Ledger.gs as a separate Apps Script project; set Script Property SOB_LEDGER_SECRET.
