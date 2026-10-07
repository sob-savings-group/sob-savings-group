# Deploying the SOB Lifetime Platform (Apps Script + Google Sheet)

Everything below is rehearsed automatically by `tests/ctl.test.js` (the bundled `Code_Ledger.gs` behind a real HTTP server, driven by the real `sobctl`).
The only thing the automated rehearsal cannot do is talk to Google, so run the **scratch rehearsal first**.

## A. Scratch rehearsal (10 minutes, no risk to real data)
1. Create an empty Google Sheet named **SOB Ledger (scratch)**. Extensions → Apps Script.
2. Replace `Code.gs` with the contents of `dist/Code_Ledger.gs` (`npm run build` creates it). Project Settings → *Show "appsscript.json"* → replace it with `deploy/appsscript.json`.
3. Project Settings → Script Properties → add `SOB_INITIAL_ADMIN_PIN` (6+ characters). Run `setupAdmin` once (authorise when asked). The PIN property deletes itself.
4. Deploy → New deployment → Web app → *Execute as: Me*, *Who has access: Anyone*. Copy the `/exec` URL. (Access is "Anyone" because people sign in inside the app with their own PIN; the server checks every request.)
5. On your computer: `export SOB_URL=<exec url> SOB_ADMIN_ID=ADMIN SOB_ADMIN_PIN=<pin>` then
   `node tools/sobctl.js ping` → `node tools/sobctl.js smoke` → `SOB_ALLOW_WRITE_TESTS=yes node tools/sobctl.js smoke-write`. All lines must say PASS.
6. Delete the scratch sheet/deployment.

## B. Production
1. Same steps 1–5 with a new Sheet named **SOB Ledger**. Do NOT run `smoke-write` here.
2. Sign-ins (offline, outside the repo): `node tools/provision-users.js <legacy.json> ~/sob-pins --staff "TREAS:Committee:Treasurer,OVERSIGHT:Committee:Oversight"` → creates `users.json` (hashes only) and `pin-slips.html/csv` (plain PINs: print, hand out, then delete the folder).
3. Data: `node tools/sobctl.js import-ledger <legacy.json> --dry-run` then without `--dry-run`. It migrates, verifies figure-for-figure, writes to the empty Sheet and re-reads it. A second import is impossible.
4. `node tools/sobctl.js import-users ~/sob-pins/users.json`.
5. Reconciliation: `python3 -I tools/extract-workbook.py <workbook.xlsx> > rows.json` (for each workbook), `node tools/reconcile-data.js <legacy.json> system-rows.json database-rows.json <today> ~/sob-recon` → read the report; then `node tools/sobctl.js register-discrepancies ~/sob-recon/reconciliation.json`.
6. When SOB approves the loan-date corrections: `node tools/sobctl.js apply-plan ~/sob-recon/reconciliation.json --approved-by "<name, role, date>"` (audited, original dates kept).
7. `node tools/sobctl.js smoke` with `SOB_MEMBER_ID/SOB_MEMBER_PIN` set to a real member → every line PASS.
8. Website: `SOB_URL=<exec url> npm run site` → publish `dist/site/` (no demo data inside).

## C. Updating later
Apps Script → Deploy → Manage deployments → edit the SAME deployment → new version (the URL must not change). Re-run `smoke` afterwards.

## D. Limits to know
Each request reads the whole Sheet once (≈15 sheets) and writes only the sheets that changed. Rehearsed at 20,000 transactions. Apps Script allows 6 minutes per request and ~90 minutes of total script time per day on free accounts, ample for a 55-member group.
