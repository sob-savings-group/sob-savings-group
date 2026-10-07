# SOB Lifetime Platform — dev status (branch `dev`; `main`/production untouched)

## Run
- `npm test` — core, workflow, backend authorization/attack tests (mock Sheets + bundled .gs sandbox), client/report tests
- `node e2e/smoke.js` — Playwright desktop + mobile, demo mode
- `node e2e/live.js` — Playwright against the real backend code: sign-in, tampered-browser attempts, member data isolation
- `npm run build` — bundles src/ into `dist/Code_Ledger.gs` (Apps Script)
- `node build/dry-run.js <legacy.json>` — migration verification; `tools/reconcile.py` — read-only source reconciliation (docs/RECONCILIATION_REPORT.md)
- UI: serve repo root, open `/app/index.html` (demo mode while `app/config.js` ledgerUrl is empty)

## Confirmed SOB decisions (7 Oct 2026) and where they live
1. UGX 5,000 subscription = group income, never member savings (`core/ledger.js` classify, `core/cycle.js`).
2. December share-out: every member withdraws full savings, including loan-holders (loan stays payable); loan-holders get no profit (`core/cycle.js`). Guarantors withdrawing are flagged `guaranteeAtRisk` — treatment not decided.
3. One guarantor per loan, covering the full loan, from available savings = savings − live guarantees (`core/loans.js`).
4. Historical discrepancies are never auto-corrected: reconciliation report only; fixes will be audited dated entries.
5. Server-side authorization (`backend/auth.js`, `backend/api.js`, `core/commands.js`): per-user PIN login (salted+stretched hashes, 5-try lockout), server-held sessions, role re-read from Users sheet each request, closed command whitelist run with a server-built identity, role-filtered reads, no snapshot-write path, import only into an empty ledger by Admin.

## Still blocked (nothing invented)
Profit formula · qualifying savings (3× limit basis; loan approval stays blocked) · Interest Receivable basis (shown provisional) · repayment allocation (interest-first vs principal-first; repayments reduce the balance in total, no split recorded).

## Still open
Q4 historical depth · Q5 Committee permissions (read-only default) · Q6 approval-separation scope · what happens to a loan whose guarantor withdraws at share-out · true disbursement dates/interest for the 10 loans · which source workbook is authoritative (see reconciliation report).

## Before any production release
- Deploy `Code_Ledger.gs` as its own Apps Script project; run `initAdmin("<id>", "<pin>")` once; Admin creates users (Admin → createUser) and sets PINs. Existing PINs are NOT migrated.
- Resolve the reconciliation differences against paper records, then import into the empty ledger.
- Not yet tested: a real deployed Apps Script/Sheet (tests use a mock), Apps Script execution-time limits at full data size, CORS/redirect behaviour of the deployed web app from GitHub Pages.
- SOB go-ahead. Nothing is merged to `main` before then.
