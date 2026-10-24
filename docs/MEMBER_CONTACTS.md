# Edit contact details (Super Admin)

**Where:** Members → open a member → **Edit contact details** (Super Admin only; the member is found by the search box on the Members page: name, SOB ID or phone).

**What can change:** WhatsApp/phone number, e-mail address, location. **Nothing else**: the SOB ID, name, registration date, status, savings, loans and every financial record are never touched by this action.

* The phone must be a Uganda number (`0772 123 456`, `+256 772 123 456`, `256772123456`); it is stored as `0772123456`, the form the Members sheet already uses. E-mail and location are optional; leave a box empty to clear it. Boxes you do not change keep their value.
* If another member already has the same number the change is refused (a reminder would reach the wrong person). Choose "Allow" only if two members really share one number.
* Every change is written to the audit trail with the old values, the new values, who did it and the reason.
* Loan Reminders read the number live: a member who had no number appears in the list the moment one is saved; the next WhatsApp link uses the new number.
* Refused for the Chairperson, Treasurer, Secretary, Committee and members (also if the browser is tampered with).

Tested offline (6 unit tests, real-screen browser test). Not yet tested on the live Google Sheet. Requires the backend of build `5e73dbd95f` or later.
