#!/usr/bin/env node
/* Wraps the PRIVATE records pack as Code_Records.gs (one file pasted into the Apps Script project next to Code.gs). Output goes outside the repository.
   usage: node tools/make-records-gs.js <pack.json> <out/Code_Records.gs> */
const fs = require("fs"), path = require("path"), [inp, out] = process.argv.slice(2);
if (!inp || !out) { console.error("usage: make-records-gs.js <pack.json> <out.gs>"); process.exit(2); }
if (path.resolve(out).startsWith(path.resolve(__dirname, "..") + path.sep)) { console.error("REFUSED: write outside the repository (real data)."); process.exit(2); }
const pack = JSON.parse(fs.readFileSync(inp, "utf8")); if (pack.kind !== "SOB_RECORDS_PACK") { console.error("not a records pack"); process.exit(2); }
fs.writeFileSync(out, "/* PRIVATE SOB records (real names and amounts). Keep inside the owner's Apps Script project; never publish. */\nfunction __sobPack(){ return JSON.parse(" + JSON.stringify(JSON.stringify(pack)) + "); }\n", { mode: 0o600 });
console.log("written", out);
