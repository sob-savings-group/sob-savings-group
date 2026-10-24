# Member Statement vs Administrative Statement

Two separate statements are produced from the same ledger. Nothing is stored twice and no financial record is changed.

| | Member Statement | Administrative Statement |
|---|---|---|
| Who | the member (own data only); officers may also print it | Admin, Chairperson, Treasurer (permission `audit.view`) only |
| Shows | savings, deposits, withdrawals, profit, share-outs, loan obligations, balances, transaction history | everything above plus references, sources, payout entry, interest working, reserve, corrections and audit notes, guarantors, pending/review items |
| Reference | `STM-<id>-<date>` | `ADM-<id>-<date>`, banner "ADMINISTRATIVE STATEMENT – officers only" |

## How it is enforced
1. **Server side (`src/backend/api.js`, `viewFor`)**: a member's login is sent only their own records with internal fields removed (source refs, officer names, evidence, review/correction notes, guarantor commitments), voided entries are removed, and the audit log is empty. A member cannot obtain these by any request.
2. **Statement builder (`src/core/statements.js`)**: `memberAccount(..., {audience})` returns the member form unless the audience is `admin`; the member form is stripped again (`memberSafe`) so the screen, the PDF and the CSV cannot show internal text.
3. **Screen/PDF (`app/app.js`)**: the Administrative statement toggle is shown only when the signed-in user is staff with `audit.view`. Officers open on the Member statement by default.

## Design choices
- Guarantor names are hidden from the Member statement.
- The member's own loan reference (LOAN-…) stays visible.
- Voided/cancelled entries do not appear to the member.

## Tests (offline)
`tests/statement_audience.test.js` (7), `tests/statements.test.js` (6), `e2e/statements.js` (real screens, mobile width, PDF download, role check, no records changed).
**Not tested live on the real Google Sheet.**
