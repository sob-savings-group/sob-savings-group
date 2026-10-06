/* DEV configuration. Live mode needs the deployed Code_Ledger.gs URL + secret; leave empty to run in DEMO mode (in-memory, seeded). */
window.SOB_CONFIG = { ledgerUrl: "", ledgerKey: "", authUrl: "", authKey: "",
  /* Staff PIN role -> platform role. Treasurer/Oversight permissions are an open SOB decision (Q5): safe read-only default. */
  staffRoleMap: { admin: "Admin", treasurer: "Committee", oversight: "Committee" } };
