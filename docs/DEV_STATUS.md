# SOB Lifetime Platform — developer notes (branch `dev`)

See `docs/RELEASE_STATUS.md` for the release verdict and `docs/DEPLOYMENT.md` for deployment.

## Commands
- `npm run verify` — all tests, build, production-site build, browser tests
- `npm test` / `npm run e2e` / `npm run build` (→ `dist/Code_Ledger.gs`) / `npm run site` (→ `dist/site`, set `SOB_URL`)
- `node tools/sobctl.js …` — operate a deployed backend; `tools/provision-users.js`; `tools/reconcile-data.js`; `tools/extract-workbook.py`
- Test data is synthetic (`tests/helpers/synth.js`). To rehearse on real data locally: `SEED=<legacy.json> SYSTEM_ROWS=… DATABASE_ROWS=… node tests/ctl.test.js`

## Confirmed rules implemented
Subscription = group income · share-out withdraws full savings for every member, loan-holders get no profit · one guarantor per loan covering the full loan from available savings · history never edited (void/restore, audited corrections with reason + evidence) · server-side authorization.

## Blocked (SOB policy)
Profit formula · qualifying savings · Interest Receivable basis · repayment allocation · Committee permissions · approval separation scope · historical depth · guarantor-withdrawal treatment.
