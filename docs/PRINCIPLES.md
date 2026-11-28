# Lifetime platform principles (set by the Chairperson, 28 Nov 2026)

Every change to this project must serve a platform that runs for many years with as little developer involvement as possible, while keeping security, approvals and the audit trail.

1. **Settings, not deployments.** A change that an officer might need (wording, dates, limits, contact numbers, switches, lists) is a setting edited inside the app, approved by the right officer and written to the audit log. It is never hardcoded. A new backend deployment is the last resort, and each release says plainly whether one is needed.
2. **Reusable and configurable.** Build general features (a message template, a report, a rule) that settings can reshape, not one-off code for one occasion.
3. **Less developer dependence.** Everyday administration (add or fix members, change reminders, run reports, switch the SMS gateway on or off, rotate a token) must be possible from the app by an officer.
4. **Built-in diagnostics.** The app shows clear status: build and server versions, whether the SMS gateway and trigger are alive, last reminder run and what it did, failures with the reason and what to do next. Admins can fix common problems without technical help.
5. **Degrade gracefully.** If Google, the SMS gateway or the network is down, say what is wrong, what still works, and what to do. No generic errors. Never lose or double-apply a financial entry.
6. **Built to grow.** Members, transactions and financial years will grow. Avoid per-record scans of the whole ledger where a summary will do; keep old years readable; test with large data.
7. **Security stays.** Approvals, roles, audit and privacy (no member data or tokens in the repository or chat) are never traded for convenience.

Release checklist: Does this need a deployment? Could it be a setting? Is there a status or diagnostic line for it? What happens when its dependency fails?
