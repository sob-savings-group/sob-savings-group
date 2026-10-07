# Real-Google walkthrough (scratch deployment)

Use the scratch Sheet + `Code.gs` deployed as a **New version**, and open `sob-app.html?url=<your /exec URL>`.
Tick each line. Report only what fails (screenshot + the words on screen).

## Admin (Super Admin) — the only role that enters or edits figures
1. Sign in `ADMIN` + PIN. Dashboard shows the "needs attention" banner and 9 cards.
2. Members → search a member → create their sign-in (note the slip PIN). Create a Treasurer and a Chairperson sign-in (System → Sign-ins).
3. Ledger → New entry: date picker opens on today; post a savings entry dated earlier; a future date is refused.
4. Loans → new application for a member (or have the member apply), add a guarantor (Request a guarantee), review (Approve → "awaiting Chairperson").
5. After the Chairperson approves: Disburse (rate, grace, date) → Record repayment dated earlier than today: check the interest/principal split and the guarantor release on the loan screen.
6. Subscriptions → record one with a chosen date. Reports → open one, Print / PDF (header, logo, five officers on every page).

## Chairperson (second approval; never enters figures)
7. Approvals → approve the loan; approve a void request raised by the Admin. The Chairperson cannot approve their own request.

## Treasurer (review only)
8. Sign in; every screen is readable; no entry or approve buttons anywhere.

## Member (phone)
9. Sign in with `SOB-0xx Name` (view-only banner) — then with `SOB-0xx` + PIN. First sign-in with a slip PIN forces choosing a private PIN.
10. Home: savings split into available (green) and held for guarantees (amber); loan card; recent activity.
11. Guarantor member: Guarantees tab shows a badge and the request; Accept → confirmation → amount moves to "held".
12. Savings: filters, running balance on every row, tap a row for details; Statement (PDF) opens a branded page; Share on WhatsApp.
13. Loans: tap the loan → you owe today, interest due, repayments split, guarantors, Loan statement (PDF).
14. More → Subscription, Share-out & profit, Airtime, notices, Change PIN, help numbers.

## Behaviour checks
15. Leave a screen 20 minutes → signed out with a message. Switch phone to airplane mode → "You are offline" banner.
16. Back-up / restore from System (Admin only), then Audit shows every action with who and why.
