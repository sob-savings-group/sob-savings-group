# SOB Lifetime Platform — release status (branch `dev`)

Member-level figures are deliberately NOT in this file: the repository is public. They are in the private reconciliation report delivered to the Admin.

## Verdict
- **Merge `dev` → `main` is technically safe**: the change is purely additive (new files only, no existing file modified or deleted, fast-forwardable). The live `index.html` and its Apps Script backends are untouched.
- **Production cut-over is not yet approved**: it needs (1) the Google scratch rehearsal and production deployment run from your own Google account (`docs/DEPLOYMENT.md`), (2) the SOB decisions below.
- Recommended: **squash-merge** (so `main` does not inherit earlier `dev` commits that contained real data), then delete/rewrite `dev`. See "Repository privacy".

## Completed
Notification outbox + SMS/WhatsApp adapters (dry-run by default, never marked SENT without a confirming live gateway; consent/opt-out; failure log) · airtime requests (UGX 20,000/month, UGX 200 fee, loan block, savings reservation, Admin fulfil → audited Withdraw) · backups & disaster recovery (checksummed nightly snapshots, offline export, editor-only restore, whole-system rebuild into an empty Sheet) · forced PIN change for slip/Admin-set PINs · Airtime/Messages/System screens and three extra reports · Engine (ledger, loans, guarantors, subscriptions, share-out, KPIs, reports, reconciliation register, integrity checks) · server-side authorization (per-user hashed PINs, lockout, server sessions, role from server, closed command whitelist, role-filtered reads, audit) · Admin + Member UI incl. PIN change/reset/sign-in creation and reconciliation screen · Apps Script bundle + manifest + deployment kit · `sobctl` (smoke, import-ledger, import-users, register-discrepancies, apply-plan, verify) · offline PIN provisioning · production site packaging (no demo data) · synthetic test data + privacy guard.

## Tests (`npm run verify`)
core 16 · workflow/rules 23 · reconciliation 6 · notifications+airtime 18 · backups 6 · backend authorization/attack 21 · client+reports 9 · Apps Script compatibility, scopes & 20k-row scale 5 · deployment-process incl. backup/restore/disaster-recovery (real CLI against the bundled backend over HTTP) 16 · privacy guard 2 · browser: demo desktop+mobile (all screens, no horizontal scroll), live-mode 33 checks, demo 66 checks (desktop+mobile) (also against the production site bundle). All pass on synthetic data and, locally, on the real data.
Not possible from this environment, so NOT verified: contacting Google (deployed Apps Script/Sheet run) and any real SMS/WhatsApp delivery. Both are user-run steps with ready tooling (`docs/DEPLOYMENT.md` A, B, F).

## Policy decisions still needed from SOB (blocked, nothing invented)
1. Profit-distribution formula. 2. Qualifying savings for the 3× loan limit (loan approval stays blocked). 3. Interest Receivable basis. 4. Repayment allocation: interest first or principal first. 5. Committee/Treasurer/Oversight permissions (read-only until decided). 6. Which entry types need a second approver. 7. Historical depth before 21 Dec 2025. 8. What happens to a live loan when its guarantor withdraws savings at the December share-out.

## Data approvals needed (evidence-based; tooling ready, one command each)
A. Apply the prepared loan-history correction (dated per the source workbook; audited; original dates kept). B. Two loans that the old system consolidated: one loan or two, and each one's interest. C. A recorded withdrawal larger than a member's savings (negative balance). D. One zero-amount withdrawal entry.

## Repository privacy
The repository is public. Pre-existing: `index.html` on `main` embeds real member names/phones. Introduced on `dev` earlier in this work and since removed from the tip: a demo file with real names and a reconciliation report/fixtures with member IDs and balances; they remain in `dev` history. All current tests/demo use synthetic data and `tests/privacy.test.js` blocks real data from being committed again.
