# Dashboard figures and their date/period (how each KPI is chosen and reconciled)

One selector sits at the top of the Dashboard and the Reports page: **This month · Last month · This quarter · This year · Last year · All time · Custom (From/To)**.
It never reaches into the future ("This month/quarter/year" run to today). Custom needs two real dates, in order, not after today.

Each KPI uses the date logic that is financially correct for what it measures:

| Basis | Meaning | Uses | KPIs |
|---|---|---|---|
| **As at** | a balance/position on the period's **last day** | `to` | Total Savings · Outstanding Loans · Interest Receivable · Loan Exposure (loans owed ÷ savings, guarantees still committed) · Active Members |
| **Cash** | balance **with movement** | `from` and `to` | Available Cash = opening balance on the first day + money in − money out = closing balance on the last day |
| **Period** | an **activity total** | `from`…`to` | Savings Received · Withdrawals & Share-Out · Loans Paid Out · Loan Repayments Received · Interest Received (interest part of repayments) · Subscriptions · Other Income · Profit Recorded · Expenses |
| **Now** | a live queue, not a date question | — | Awaiting approval · Loan pipeline |

"As at" really means that day: a loan counts only from the day it was paid out; interest runs only to that day (even if the loan was cleared later); repayments, guarantees and releases after that day are not counted; guarantees count only from the day they were committed and only for what repayments up to that day had not yet released. Entries that are voided or awaiting the Chairperson's approval never count.

## The chain: KPI → drill-down → entries → report/PDF
Every KPI is one calculation in `src/core/kpis.js` (`detail` / `report`). The dashboard card, the drill-down table, the CSV and the PDF are all the same object, so they cannot disagree.
- The drill-down lists the members / loans / entries behind the figure and shows a green tick when **the rows add up to the card** (`data-tie`). A red warning appears if they ever do not.
- Rows open the underlying record **as at the chosen date** (member statement, loan position, ledger entry).
- Print / PDF carries the SOB letterhead, the reporting period and the same total. Repayments are split into interest part / loan reduced using the confirmed SOB rule (interest first).

## Tests that guard this
`tests/kpi_chain.test.js` (card = drill rows = report for every KPI × 10 period types; a past date equals a ledger cut off at that date; loans paid out later / cleared later; guarantees as at; member statements tie to the savings row; the PDF header and total) and `e2e/kpi.js` (real browser: selector → cards equal the engine → drill ties → member opens as at that date → PDF period and total).
