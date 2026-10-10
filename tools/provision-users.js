#!/usr/bin/env node
/* OFFLINE sign-in provisioning. Generates a random PIN for every member and for each staff ID, hashes them exactly as the server does, and writes:
     users.json   pre-hashed users (every one must set their own PIN at first sign-in) (safe to send to the server: `sobctl import-users`)
     pin-slips.csv / pin-slips.html   PLAINTEXT PINs to hand to members. Print, distribute, then DELETE. Never commit or email these.
   usage: node tools/provision-users.js <legacy-or-ledger.json> <outDir> [--staff "ADMIN:Admin:Super Admin name,CHAIR:Chairperson:Name,TREAS:Treasurer:Name"] */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const A = require("../src/backend/auth.js");
const [src, outDir] = process.argv.slice(2); const si = process.argv.indexOf("--staff"), staff = si > 0 ? process.argv[si + 1].split(",").filter(Boolean).map((s) => { const [id, role, name] = s.split(":"); return { id, role, name: name || id }; }) : [];
if (!src || !outDir) { console.error("usage: node tools/provision-users.js <data.json> <outDir> [--staff ID:Role:Name,...]"); process.exit(2); }
if (path.resolve(outDir).startsWith(path.resolve(__dirname, ".."))) { console.error("REFUSED: write the PIN slips outside the repository (they contain plain PINs)."); process.exit(2); }
const env = { hash: (s) => crypto.createHash("sha256").update(s).digest("hex"), randomToken: () => crypto.randomBytes(16).toString("hex") };
const members = JSON.parse(fs.readFileSync(src, "utf8")).members.filter((m) => m.status !== "Inactive");
const pin = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0"), users = [], slips = [];
staff.forEach((s) => { const p = String(crypto.randomInt(10000000, 100000000)); users.push(A.makeUser(env, { id: s.id, name: s.name, role: s.role, pin: p })); slips.push({ id: s.id, name: s.name, role: s.role, pin: p }); });
members.forEach((m) => { const p = pin(); users.push(A.makeUser(env, { id: m.id, name: m.name, role: "Member", memberId: m.id, pin: p })); slips.push({ id: m.id, name: m.name, role: "Member", pin: p }); });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "users.json"), JSON.stringify(users.map((u) => ({ id: u.id, name: u.name, role: u.role, memberId: u.memberId, salt: u.salt, pinHash: u.pinHash, mustChange: true })), null, 1));
fs.writeFileSync(path.join(outDir, "pin-slips.csv"), "id,name,role,pin\n" + slips.map((s) => [s.id, '"' + s.name.replace(/"/g, '""') + '"', s.role, s.pin].join(",")).join("\n") + "\n");
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
fs.writeFileSync(path.join(outDir, "pin-slips.html"), '<!doctype html><meta charset="utf-8"><title>SOB PIN slips</title><style>body{font:14px sans-serif}.s{display:inline-block;width:46%;margin:6px;padding:10px;border:1px dashed #555;page-break-inside:avoid}b{font-size:20px;letter-spacing:3px}</style><h2>Sons of Bethel Savings Group — sign-in slips (confidential)</h2>' +
  slips.map((s) => '<div class="s">' + esc(s.name) + " (" + esc(s.id) + ")<br>PIN: <b>" + esc(s.pin) + "</b><br><small>Change it after your first sign-in.</small></div>").join(""));
console.log("Provisioned " + users.length + " sign-ins (" + staff.length + " staff, " + members.length + " members). Slips are PLAINTEXT: print and delete " + outDir + "/pin-slips.*");
