# SOB Lifetime Platform: independent review (build recorded in dist)

Scope: the 13-point brief of 17 Nov 2026. Everything below was checked OFFLINE (unit tests, browser tests against a mock sheet, demo data). Nothing here was verified on the live Google Sheet.

## Confirmed in code and tests
- One sign-in for all roles; role found by the server per request; closed command list; requester cannot approve own request.
- Member view is filtered on the SERVER (`viewFor`): no other members, no audit log, reserve, approvals, reconciliations, outbox, officer notes or internal references. Tested in `tests/backend.test.js`, `tests/privacy.test.js`.
- Verification codes: hash only stored, 10 minutes, 5 tries, rate limited, generic replies; staff not recoverable by code.
- Financial years independent; balance brought forward only by an approved, audited entry (`docs/FINANCIAL_YEARS.md`).
- Reporting: 19 reports, filters (year, dates, member, status), PDF, Excel, CSV; trial balance shows any unexplained difference instead of hiding it.
- Accounting format on screen, PDF and Excel: right-aligned figures, negatives in brackets and red, ruled totals, running balances.
- Period labels are specific (e.g. "November 2026", "Quarter 4 2026"); no "this/last" wording is shown.
- Managed lists (Admin adds / retires, "Other (Specify)" built in, every change audited, old records keep their wording): transaction purposes (six lists), loan purposes, member locations, reasons for declining / rejecting / voiding. Entry TYPES (Savings, Withdraw, Loan Repayment...) are deliberately NOT configurable because they drive the arithmetic. Report Centre can filter by Category (purpose).
- Accounting format (brackets + red negatives, right-aligned figures, ruled totals) applied to the Report Centre, dashboard drill-downs, legacy statements and member / year-end statements.

## Not yet done or not verifiable here
- Live delivery of email/SMS codes (needs `authorizeSOB` re-run for the mail scope, MailApp quota, SMS gateway test).
- No review of real production data (unrealistic figures can only be judged by SOB on the live screens).
- Performance measured only on a 20,000-row synthetic ledger (command ~170 ms in memory).

## Member classification (Chairperson's instruction, 17 Nov 2026)
- SOB-051 is a registered individual SOB member. It is not, and is not to be treated as, a group or organisational account. (SOB-015 is also an ordinary member; it was never in question.) No structural change, migration or reclassification.
- The platform has no special account class and none is to be introduced: every member keeps the existing member structure and approved records.
- The ledger is a supplementary validation source only. Member classification follows the SOB member records and the platform design.
- Before raising or implementing any change: check the existing SOB records and platform rules first, then label the observation (system issue, policy question, terminology, presentation).
