/* The scheduled entry points run inside the bundled Apps Script code on a mock Sheet: switched off by default, nothing sent, nothing changed. Run: node tests/auto_trigger.test.js */
const assert = require("assert"), g = require("./helpers/gas.js");
const s = g.start(); s.setupAdmin();
const r = JSON.parse(s.sb.dailyReminders()); assert.strictEqual(r.enabled, false); assert.strictEqual(r.sent, 0); assert.match(r.note, /switched off/);
assert.strictEqual(typeof s.sb.installReminderTrigger, "function");
console.log("1 scheduled-reminder test passed");
