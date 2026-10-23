# Loan Reminders (WhatsApp) — Super Admin guide

Menu: **Loan Reminders** (Super Admin only). Offline-tested; **not yet tested live** on the real Google Sheet (see "Before first use").

## What it does
For every member with an unpaid loan it prepares a personal WhatsApp message — name, SOB ID, loan principal, disbursement date, monthly interest, interest period, accrued interest, repayments received, outstanding principal, unpaid interest, **total outstanding**, approved deadline, days remaining and days to the share-out — and opens that member's **private** WhatsApp chat with the message ready. You press Send in WhatsApp yourself.

* Every figure is calculated by the same loan engine the Loans screen and statements use, from the live ledger, at the moment you prepare the message. Nothing is typed into a template. The message shows the calculation time.
* **Nothing is sent by the system.** There is no automatic sending and no delivery receipt from WhatsApp. "Opened" is recorded as *WhatsApp opened (delivery NOT confirmed)*. It becomes *Sent (confirmed by officer)* only when you tap **I sent it**.
* Reminders never change a loan, repayment, interest figure, balance or approval. Repayments are recorded in the ledger in the normal way; the next reminder then reflects them automatically.

## Before first use (once)
1. Put the new backend in place (paste the new `Code_Ledger.gs`, then Deploy → Manage deployments → Edit → New version). The first reminder action creates the **Reminders** sheet automatically.
2. **Set share-out date & deadline.** Choose the official December share-out date and the approved repayment deadline (on or before it) and give the authority (e.g. committee decision). This goes to the **Chairperson for approval**; until approved, no reminder can be prepared. You can also give one loan its own approved deadline (row button *Deadline*; also Chairperson-approved).
3. Optionally adjust **Timing** (when *Urgent* and *Final Notice* start; minimum days between reminders) and **Message wording** (words only — figures cannot be typed in; allowed placeholders: `{name} {id} {deadline} {daysToDeadline} {shareOutDate} {daysToShareOut}`).

## Using it
* **Preview** — shows exactly what would be sent; saves nothing.
* **WhatsApp** (per member) — prepares and records the message, then shows it with an **Open WhatsApp chat (private)** button. Tap it, press Send in WhatsApp, return and tap **I sent it**.
* **Prepare reminders for all N** — prepares one individually addressed message per member (never a group). Members who cannot be reminded safely are skipped with the reason (no valid WhatsApp number, notifications switched off, start date not established, schedule not set, reminded too recently). Open each one yourself.
* **Level** — *Automatic* picks Friendly / Urgent / Final Notice for each member from the days left to the approved deadline (overdue = Final Notice). You may choose a level yourself; the record shows what the system recommended.
* **History and follow-up** — every reminder with time, level, balance at that time, delivery status and follow-up (awaiting reply, replied, promised to pay by a date, no response, closed). A promise to pay is only a note.
* A reminder prepared earlier is refused if the balance has since changed or the day has changed — prepare a new one. The same reminder cannot be prepared twice (duplicate protection).

## What it will not do
* It will not guess: with no share-out date/deadline set, or figures that cannot be verified, or the live backend unreachable, **no reminder is produced**.
* Historical loan accounts (from before the current register) are not reminded here; they are handled under Reconciliation.
* It does not send SMS or WhatsApp by itself, and does not confirm delivery.

Wording note: the Urgent and Final texts say unpaid balances "will be dealt with in line with the group's approved policies". Edit the wording if the committee has specific, approved consequences to state.
