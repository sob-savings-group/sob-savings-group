# Loading the real SOB records — fastest path (owner, about 5 minutes)

1. Apps Script → replace **Code.gs** with the new one; add a new file **Code_Records.gs** (private, from the delivery) and paste its contents.
2. Run **installSOBRecords** (choose it in the function list → Run). It removes only "Demo Member NNN" sample records (backup first), loads all verified current and historical records, registers the exceptions, submits the corrections to the Chairperson, and creates sign-ins. Results: sheet **SOB Load Log**; one-time PINs: sheet **PIN slips - DELETE AFTER PRINTING**.
3. Deploy → Manage deployments → Edit → New version.
4. The Chairperson (ID CHAIR) signs in, approves the requests in Approvals (the void first). Run **installSOBRecords** once more: it records the four dated repayments and closes the corrected loan-date items.
5. Print the PIN slips, then delete that sheet and Code_Records.gs.

Settled SOB decisions built in (8 Oct 2026): Bishop = SOB-003 (108 rows imported); the two undated genuine transactions keep their source position (after/before dated neighbours) with no invented date; consolidated loans stay ONE account with their dated components (Chairperson-approved); the guarantor policy begins 1 Jan 2027; actual savings = deposits + profit - withdrawals - share-outs; the 50 historical exceptions were matched against the loan register, group bank ledger and phone numbers (15 explained and closed, 35 left unposted for lack of exact evidence).

Tested with tests/install.test.js (synthetic data) and privately on the real records. Needs real-Google confirmation: Apps Script run time (6-minute limit; the run is repeatable and resumes), and the Chairperson approvals.

---
## Alternative: from inside the app

The real records are loaded from inside the app (Super Admin → System → **Load SOB records**). No Node, no command line.

1. Redeploy the new `Code.gs` (Apps Script → Deploy → Manage deployments → Edit → New version). It adds one guarded action, *remove demo records*.
2. Open `sob-app.html`, sign in as ADMIN, open **System**.
3. Choose `SOB_RECORDS_PACK.json` (private file; never put it in GitHub).
4. If the Sheet shows *demo/sample records*, press **Remove demo records**. This runs only when **every** member in the Sheet is a known demo name and **none** is a real SOB member; a backup is taken first. A Sheet that already holds real members can never be purged.
5. Type *Approved by (name, role, date)*, press **Check only**, then **Load records**.
6. Corrections (loan start dates, the SOB-035 consolidated repayment) are sent to the Chairperson as requests. After the Chairperson approves them in **Approvals**, press **Load records** once more: the four dated SOB-035 repayments are recorded and the register items for the corrected loan dates are closed.
7. Create sign-ins (same screen): members get random PINs on a downloadable slip; add the Chairperson and Treasurer. Print the slips, hand them out, delete the file.

Safe to repeat: current records go in only once (empty ledger), historical rows are matched by source reference, register items by subject, corrections by request. Nothing is deleted, nothing is changed to force a balance.

What it does **not** do: guess SOB-003's identity (108 rows stay staged), post the 50 held rows (they stay in the reconciliation register), invent dates for the two undated amounts (audit notes only), decide whether LOAN-VH6W0S / LOAN-25TZE8 are one loan or several (SOB decision).

Tested: loader against the bundled `Code_Ledger.gs` (tests/loader.test.js, e2e/records.js, synthetic data) and privately on the real records (not committed). Needs real-Google verification: the same run on the live Sheet (Apps Script execution time for ~970 rows, the Chairperson approvals).
