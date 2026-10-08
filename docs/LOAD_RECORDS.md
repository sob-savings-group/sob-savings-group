# Loading the real SOB records

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
