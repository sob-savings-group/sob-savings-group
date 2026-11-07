# Financial years, Balance Brought Forward, explicit periods and configurable lists

## SOB policy as implemented
* A financial year begins on the day of the approved share-out that closed the previous one and ends at the next approved share-out. Years are independent accounting periods.
* **Nothing is inherited automatically.** A new year opens at zero for every member. The previous year's closing position is shown *for information*, together with the part
  that stays in the club's consolidated position (previous closing − Balance Brought Forward).
* A member's year opens with a balance only when an authorised officer deliberately records a **Balance Brought Forward** (Financial Years screen).
  It needs evidence and a reason, may never exceed the member's previous-year closing position, is requested by the Super Admin and takes effect only when the
  Chairperson approves. It can be voided (also with approval). Both are audited.
* The four things are always shown apart: previous-year closing position · club consolidated balance · authorised Balance Brought Forward · new-year transactions.

## What this does NOT change
Ledger entries, loans, interest, profit distributions, the share-out and every member's **live savings total** are untouched. A Balance Brought Forward is a separate
record (`yearOpenings`). The health check now verifies that the years' own movements add up to the live savings total.
One consequence to be aware of: a year in which a member was paid out more than that year's own deposits (because the money came from an earlier year) shows a negative
year closing until a Balance Brought Forward is recorded for that member. Loan eligibility, withdrawals and profit still use the live savings total, as before.

## Explicit periods
Pickers and reports name the real period: "Financial Year 2026", "November 2026", "Quarter 4 2026 (October – December)". No "this year / last month" wording remains.

## Configurable lists
Purposes (savings, withdrawals, expenses, income, profit, bank charges) are lists with standard options. The Super Admin adds or retires options in System → Lists and options
(audited, no redevelopment). Every list also offers **Other (Specify)**; the typed text is recorded exactly. Lists are labels only: no calculation depends on them and
past entries are never rewritten. Ledger entry *types* (Savings, Withdraw, ...) are deliberately not configurable: they drive the accounting.

## Tests (offline)
tests/fy.test.js, tests/fy_policy.test.js, tests/statement_audience.test.js, e2e/fyears.js. Not verified on the live Google Sheet.
