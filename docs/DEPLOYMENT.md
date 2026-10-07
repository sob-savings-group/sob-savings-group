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
7. `node tools/sobctl.js smoke`. With `SOB_MEMBER_ID/SOB_MEMBER_PIN` set to a member's *slip* PIN, smoke proves the server forces a PIN change and then skips the member checks (so it never changes a real member's PIN). To run them, also set `SOB_MEMBER_NEW_PIN` (it sets that member's own PIN) or use a member who has already chosen one → every line PASS.
8. Backups (once): Apps Script editor → Run `installBackupTrigger` (nightly snapshot at about 02:00; authorise "manage your triggers"). Then `node tools/sobctl.js backup-now` and `node tools/sobctl.js backup ~/sob-backups/first.json` (a verified offline copy outside the repository; contains personal data, keep it private).
9. Website: `SOB_URL=<exec url> npm run site` → publish `dist/site/` (no demo data inside).

## B2. Sign-in (PIN) workflow
- Every sign-in created by the provisioning tool, by Admin "Create sign-in", or by Admin "Reset PIN" is marked **must change**: the server refuses everything except changing the PIN until the owner chooses their own (members 4+ characters, staff 6+). Printed slips therefore stop being valid secrets after first use.
- Lost PIN: Admin → Members → the member → *Reset PIN*. Disable a sign-in: Admin → System → Sign-ins. Five wrong PINs lock that ID for 15 minutes.
- Hand slips out in person, then delete `~/sob-pins`.

## C. Updating later
Apps Script → Deploy → Manage deployments → edit the SAME deployment → new version (the URL must not change). Re-run `smoke` afterwards.

## E. Backups and disaster recovery
- **What is backed up**: members, ledger, loans, guarantees, cycles, audit log, reconciliation register, airtime, outbox. **Never** PINs/credentials.
- **Nightly in-sheet snapshots** (`Backups` sheet): checksummed, kept = newest 30 + the newest of each of the last 12 months + every pre-restore snapshot. Unchanged ledgers are not duplicated. Admin → System shows them and can verify each one.
- **Offline copy**: `sobctl backup <file>` (or Admin → System → Download offline backup). Check any file with `sobctl backup-verify <file>`; tampering is detected (SHA-256 + record counts).
- **Recover from a bad change inside the same Sheet** (spreadsheet owner only, deliberately not reachable from the web): add Script Property `SOB_RESTORE_BACKUP_ID` = the snapshot id → Run `restoreFromProperty`. It first saves a `pre-restore` snapshot of the current state, restores the snapshot, keeps all sign-ins, and writes an audit record saying what was dropped.
- **Recover the whole system** (Sheet deleted/corrupted): new empty Sheet → steps B1 (Sheet, script, admin, deployment) → `sobctl restore-backup <file>` (only into an empty ledger; it proves counts, ids, per-member savings and every loan balance equal the file) → provision/import sign-ins again → update the website URL if it changed. Rehearsed in `tests/ctl.test.js` ("DISASTER RECOVERY").
- Google Sheets' own version history is an additional safety net.

## F. SMS / WhatsApp notifications and airtime
**Status: built and tested with a fake gateway only. Nothing has been sent to a real phone by this project.** Out of the box every message is written to the **Outbox** and shown on Admin → Messages as DRY-RUN; nothing is sent.
To go live (needs your own credentials; nothing here is invented):
1. SMS (Traccar SMS Gateway as in the old system): Script Properties `SOB_SMS_GATEWAY_KEY` (your gateway token), optional `SOB_SMS_GATEWAY_URL` (default https://www.traccar.org/sms/), `SOB_ADMIN_PHONE` (your number, e.g. 0772123456). Run `testSms` from the editor: it sends ONE message to `SOB_ADMIN_PHONE` and shows the result. Only when your phone really received it, add `SOB_SMS_LIVE` = `yes-tested`.
2. WhatsApp (Meta WhatsApp Cloud API): `SOB_WA_TOKEN`, `SOB_WA_PHONE_ID`; run `testWhatsApp`; then `SOB_WA_LIVE` = `yes-tested`. Note: WhatsApp only allows free text inside a 24-hour customer window; messages started by SOB normally need Meta-approved templates, which are not built yet.
3. Admin → Messages → *Process outbox*. A message becomes SENT only after the live gateway confirms it; failures are listed, logged and retried up to 3 times.
- Members can switch notices off on their Home screen; opted-out members and members without a valid Uganda number are skipped and shown as such.
- **Airtime**: members request (UGX 20,000 per calendar month, blocked while a loan is unpaid, UGX 200 SMS fee shown first); nothing is deducted until Admin presses *Fulfil*, which records one audited Withdraw entry. Pending requests reserve the member's available savings (savings minus live guarantees).
- Admin sends the airtime itself outside the system (the platform records and debits; it does not buy airtime).

## D. Limits to know
Each request reads the whole Sheet once (≈17 sheets) and writes only the sheets that changed. Rehearsed at 20,000 transactions. Apps Script allows 6 minutes per request and ~90 minutes of total script time per day on free accounts, ample for a 55-member group.

## G. Historical records (2024–2025 workbook) → lifetime histories
The earlier Excel records are loaded through the audited bulk command `importHistoricalEntries` (Admin only; types Savings / Profit / Withdraw / Share-Out).
- Every row keeps its **original date** and a **source reference** (`workbook | sheet | row`); ids are deterministic, so re-running a batch adds nothing.
- A row equal to an existing live entry (same member, date, type, amount) is reported as a possible duplicate and is **not** added. No amount is ever adjusted; a bad row rejects the whole batch.
- The member mapping and the import pack are built **privately** (they contain real names; never commit them: `history-pack*.json` and `REPORT_private*` are git-ignored).
- Run: `sobctl import-history <history-pack.json> --approved-by "<name, role, date>" --dry-run`, then without `--dry-run`. It takes a backup snapshot first, imports in chunks, then proves: existing records untouched, count rose by exactly the imported rows, each member's savings moved by exactly the imported net, integrity not worse, re-run adds nothing.
- Members whose history cannot be classified or closed without guessing (loan-involved members, unmatched sheets, overdrawn balances) are held whole until SOB confirms; they are never partially imported.
- Members that exist only in the historical records are created first, with their **confirmed SOB IDs** (pack `members` list → `addMember` with an explicit, validated `SOB-nnn` id), and each imported row keeps the name as originally written (`originalName`). A historical block is never attributed to the member whose sheet it happens to sit on. New members still need sign-ins provisioned (`provision-users`) if they should use the portal.
