/* SOB core/status — the System Status Centre. One list of checks an administrator can read at a glance: what is working, what needs attention,
   and exactly what to do about it. Nothing here writes anything and nothing here needs a deployment to change a threshold: every limit is a setting
   in LIMITS (override with o.limits). compose(db, facts, o) -> { overall: "ok"|"warn"|"fail", items: [{ id, group, label, state, detail, action }], actions: [..] }.
   `facts` is what the server reports about itself (its build, gateway switches, e-mail quota, triggers, last run) or null when the server cannot be reached. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.status = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const LIMITS = { staleRunDays: 2, staleBackupDays: 3, queueWarnCount: 20, queueOldDays: 2, failedWarnCount: 1, emailQuotaLow: 20, rowsWarn: 20000, rowsFail: 60000, approvalsWarn: 5, approvalsOldDays: 3 };
  const days = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
  const rank = { ok: 0, info: 0, warn: 1, fail: 2 };
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  function compose(db, facts, o) {
    o = o || {}; const lim = Object.assign({}, LIMITS, o.limits || {}), today = o.today, items = [];
    const add = (id, group, label, state, detail, action) => items.push({ id, group, label, state, detail, action: action || "" });
    const outbox = db.outbox || [], audit = db.auditLog || [], dOf = (m) => String(m.createdAt || m.createdDate || "").slice(0, 10);

    /* ---- the server ---- */
    if (!facts) {
      add("backend", "Connection", "Backend connection", "fail", "The app could not reach the ledger server" + (o.error ? " (" + o.error + ")" : "") + ". Nothing you see here was changed.",
        "Check your internet. If other people see the same problem, open the Apps Script project, Deploy > Manage deployments, and confirm the web app is still deployed with access set to Anyone. Your records in the Sheet are safe.");
    } else {
      add("backend", "Connection", "Backend connection", "ok", "The ledger server answered.");
      const a = o.appBuild || "", s = facts.build || o.serverBuild || "";
      if (a && s && a !== s) add("version", "Connection", "App and server version", "warn", "App " + a.slice(0, 6) + " and server " + s.slice(0, 6) + " are different builds.",
        "Only needed if the update says the server changed: paste the latest Code_Ledger.gs and Deploy > Manage deployments > pencil > New version. If the release note says no server change, ignore this.");
      else add("version", "Connection", "App and server version", "ok", s ? "Both are build " + s.slice(0, 6) + "." : "Version not reported.");
      if (facts.timeZone && facts.timeZone !== "Africa/Kampala") add("tz", "Connection", "Time zone", "warn", "The server clock uses " + facts.timeZone + ", not Africa/Kampala. Reminder times and dates can be off.", "In the Apps Script project: Project Settings > Time zone > Africa/Kampala.");
    }

    /* ---- messaging ---- */
    const sms = facts && facts.sms;
    if (facts) {
      if (!sms || !sms.configured) add("sms", "Messaging", "SMS gateway", "warn", "No SMS gateway key is saved. Messages are prepared but not sent.", "Apps Script > Project Settings > Script Properties: add SOB_SMS_GATEWAY_KEY, then run testSms from the editor on your own phone.");
      else if (!sms.live) add("sms", "Messaging", "SMS gateway", "warn", "A key is saved but the gateway is switched OFF, so nothing is sent.", "After testSms succeeds on your own phone, set Script Property SOB_SMS_LIVE to yes-tested.");
      else add("sms", "Messaging", "SMS gateway", "ok", "Live. Messages are sent through the gateway phone.");
      if (sms && sms.live && !sms.adminPhone) add("smsAdminPhone", "Messaging", "Test phone", "info", "SOB_ADMIN_PHONE is not set, so testSms cannot run.", "Add your own number as Script Property SOB_ADMIN_PHONE.");
      const wa = facts.wa; if (wa && wa.configured) add("wa", "Messaging", "WhatsApp", wa.live ? "ok" : "warn", wa.live ? "Live." : "Configured but switched OFF.", wa.live ? "" : "Set Script Property SOB_WA_LIVE to yes-tested after a successful test.");
      if (facts.emailQuota === undefined || facts.emailQuota === null) add("email", "Messaging", "E-mail service", "warn", "Could not read the e-mail allowance" + (facts.emailError ? " (" + facts.emailError + ")" : "") + ".", "Run authorizeSOB once from the Apps Script editor to give e-mail permission, then deploy a New version.");
      else if (facts.emailQuota < lim.emailQuotaLow) add("email", "Messaging", "E-mail service", "warn", plural(facts.emailQuota, "e-mail") + " left in today's allowance.", "Sign-in codes by e-mail may stop until tomorrow. Use SMS codes, or wait for the allowance to reset.");
      else add("email", "Messaging", "E-mail service", "ok", plural(facts.emailQuota, "e-mail") + " left in today's allowance.");
    }

    /* ---- queue and failures (from the ledger itself, so they show even when the server cannot be reached) ---- */
    const cnt = (st) => outbox.filter((m) => m.status === st).length, queued = outbox.filter((m) => m.status === "QUEUED"), dry = cnt("DRY_RUN");
    const oldQ = today ? queued.filter((m) => dOf(m) && days(dOf(m), today) >= lim.queueOldDays).length : 0;
    if (queued.length === 0 && dry === 0) add("queue", "Messaging", "Message queue", "ok", "Nothing is waiting.");
    else if (queued.length >= lim.queueWarnCount || oldQ) add("queue", "Messaging", "Message queue", "warn", plural(queued.length, "message") + " waiting to be sent" + (oldQ ? ", " + oldQ + " for " + lim.queueOldDays + " days or more" : "") + ".", "Messages > Process outbox. If they stay QUEUED, check the SMS gateway above and that the gateway phone is on and online.");
    else add("queue", "Messaging", "Message queue", queued.length ? "info" : "ok", plural(queued.length, "message") + " waiting" + (dry ? ", " + dry + " prepared but not sent (gateway off)" : "") + ".", dry ? "Messages prepared while the gateway was off are not sent later. Send them again once the gateway is live." : "");
    const failed = outbox.filter((m) => m.status === "FAILED" && (!today || !dOf(m) || days(dOf(m), today) <= 14));
    if (failed.length >= lim.failedWarnCount) { const why = {}; failed.forEach((m) => { const r = String(m.reason || m.error || "no reason recorded").slice(0, 60); why[r] = (why[r] || 0) + 1; }); const top = Object.keys(why).sort((a, b) => why[b] - why[a]).slice(0, 2).map((r) => r + " (" + why[r] + ")").join("; ");
      add("failed", "Messaging", "Failed messages (last 14 days)", "warn", plural(failed.length, "message") + " failed. Most common: " + top + ".", "Messages > filter FAILED > read the Note. Fix the cause (number, gateway phone, token), then resend the ones that still matter. The system never re-sends an SMS by itself."); }
    else add("failed", "Messaging", "Failed messages (last 14 days)", "ok", "None.");

    /* ---- scheduled jobs ---- */
    if (facts) {
      const trig = facts.triggers; if (!trig) add("triggers", "Scheduled jobs", "Triggers", "warn", "Could not read the schedule" + (facts.triggersError ? " (" + facts.triggersError + ")" : "") + ".", "Run authorizeSOB once from the Apps Script editor, then deploy a New version.");
      else { const has = (f) => trig.some((t) => t.fn === f);
        add("trigReminders", "Scheduled jobs", "Daily reminders", has("dailyReminders") ? "ok" : "warn", has("dailyReminders") ? "Scheduled (about 9am)." : "Not scheduled. Automatic reminders will not run.", has("dailyReminders") ? "" : "In the Apps Script editor run installReminderTrigger once.");
        add("trigBackup", "Scheduled jobs", "Daily backup", has("dailyBackup") ? "ok" : "warn", has("dailyBackup") ? "Scheduled (about 2am)." : "Not scheduled. No automatic backups.", has("dailyBackup") ? "" : "In the Apps Script editor run installBackupTrigger once."); }
      const lr = facts.lastReminderRun, auto = o.autoEnabled;
      if (lr && lr.at) { const d = String(lr.at).slice(0, 10), age = today ? days(d, today) : 0, line = d + ": " + (lr.sent || 0) + " sent, " + (lr.failed || 0) + " failed" + (lr.note ? ". " + lr.note : "");
        add("lastRun", "Scheduled jobs", "Last reminder run", auto && age > lim.staleRunDays ? "warn" : (lr.failed ? "warn" : "ok"), line + (age > 0 ? " (" + plural(age, "day") + " ago)" : " (today)") + ".", auto && age > lim.staleRunDays ? "Automatic reminders are on but have not run for " + plural(age, "day") + ". Check the Daily reminders trigger above." : (lr.failed ? "Some reminders failed: see Failed messages." : "")); }
      else { const e = audit.filter((x) => x.entityType === "AutoReminderRun").pop();
        add("lastRun", "Scheduled jobs", "Last reminder run", auto ? "warn" : "info", e ? "Last recorded run: " + e.date + " (" + e.action + ")." : "No automatic reminder run has been recorded yet.", auto ? "Automatic reminders are on, but no run is recorded. Check the Daily reminders trigger above." : ""); }
    }

    /* ---- reminders and approvals ---- */
    if (o.autoEnabled !== undefined) add("autoSwitch", "Operations", "Automatic reminders", o.autoEnabled ? (o.deadlineApproved === false ? "warn" : "ok") : "info", o.autoEnabled ? (o.deadlineApproved === false ? "On, but no approved deadline, so nothing will be prepared." : "On.") : "Off.", o.autoEnabled && o.deadlineApproved === false ? "Loan Reminders: set the deadline; the Chairperson approves it." : "");
    const pend = (db.approvalRequests || []).filter((r) => r.status === "Pending"), oldP = today ? pend.filter((r) => r.requestedDate && days(r.requestedDate, today) >= lim.approvalsOldDays).length : 0;
    add("approvals", "Operations", "Waiting for approval", oldP || pend.length >= lim.approvalsWarn ? "warn" : (pend.length ? "info" : "ok"), pend.length ? plural(pend.length, "request") + " waiting" + (oldP ? ", " + oldP + " for " + lim.approvalsOldDays + " days or more" : "") + "." : "Nothing waiting.", pend.length ? "The Chairperson: Approvals > approve or decline." : "");

    /* ---- backups and growth ---- */
    if (o.backups) { const b = o.backups[0], age = b && today ? days(String(b.createdAt).slice(0, 10), today) : null;
      add("backup", "Data", "Latest backup", !b ? "warn" : age > lim.staleBackupDays ? "warn" : "ok", !b ? "No backup found." : "Saved " + String(b.createdAt).slice(0, 10) + (age ? " (" + plural(age, "day") + " ago)" : " (today)") + ".", !b || age > lim.staleBackupDays ? "System > Backups > Save a snapshot now, and check the Daily backup trigger above." : ""); }
    const rows = (db.transactions || []).length + outbox.length + audit.length;
    add("size", "Data", "Records stored", rows >= lim.rowsFail ? "fail" : rows >= lim.rowsWarn ? "warn" : "ok", rows.toLocaleString("en-US") + " rows (" + (db.transactions || []).length.toLocaleString("en-US") + " transactions, " + outbox.length.toLocaleString("en-US") + " messages, " + audit.length.toLocaleString("en-US") + " audit lines).",
      rows >= lim.rowsWarn ? "The app is getting heavy to load. Ask for the archive step (move closed financial years to an archive sheet) before it slows down for members." : "");

    const overall = items.reduce((m, i) => Math.max(m, rank[i.state] || 0), 0), actions = items.filter((i) => i.action && (i.state === "warn" || i.state === "fail")).map((i) => ({ id: i.id, label: i.label, action: i.action }));
    return { overall: ["ok", "warn", "fail"][overall], items, actions, counts: { ok: items.filter((i) => i.state === "ok").length, warn: items.filter((i) => i.state === "warn").length, fail: items.filter((i) => i.state === "fail").length } };
  }
  return { compose, LIMITS };
});
