# Loan reminders by SMS (Traccar SMS Gateway)

Officers can send ONE prepared loan reminder by SMS from Loan Reminders → Prepare → **Send by SMS** (after a confirmation). WhatsApp stays available.

## Rules built in
* The text is re-checked against the ledger at the moment of sending (same rules as WhatsApp); stale or changed balances are refused.
* Goes only to the member's own saved number; refused if the member switched notifications off.
* A repeat tap can never send twice. A targeted send touches nothing else in the outbox.
* "SMS accepted by gateway" means the gateway took it. It is NOT proof the member received it. Failures are recorded with the reason.
* Nothing is sent unless the credentials AND the switch below are set. The token is stored only in the Sheet's Script Properties: never in the code, the website, GitHub or a chat.
* No ledger entry, loan or balance is ever changed by sending.

## One-time setup (Google Apps Script)
1. Install the Traccar SMS Gateway app on an Android phone with the SIM (or eSIM) that will send. Copy the **token** shown in the app (cloud mode).
2. Apps Script → Project Settings (gear) → Script Properties → Add:
   * `SOB_SMS_GATEWAY_KEY` = the token
   * `SOB_ADMIN_PHONE` = your own number (e.g. 0772xxxxxx)
3. Editor: choose function `testSms` → Run (accept the permission prompt). Your own phone must receive "SOB test message - gateway check".
4. Only after that arrives: add Script Property `SOB_SMS_LIVE` = `yes-tested`.
5. Deploy the new Code.gs as a New version.
The phone must stay on, charged and online. Networks may limit bulk SMS: send reminders in small batches.

## Tests (offline)
tests/reminders.test.js (3 SMS tests), e2e/sms.js. **Never run against the real gateway by the developer.**
