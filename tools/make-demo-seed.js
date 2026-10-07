#!/usr/bin/env node
/* Writes the PUBLIC demo data set (fully synthetic, deterministic). usage: node tools/make-demo-seed.js [out.json] */
const fs = require("fs"), path = require("path"), d = require("../tests/helpers/synth.js").build();
const out = process.argv[2] || path.join(__dirname, "../app/demo-seed.json"); fs.writeFileSync(out, JSON.stringify(d.legacy));
console.log("synthetic demo seed written:", d.legacy.members.length, "members,", d.legacy.transactions.length, "transactions,", d.legacy.loans.length, "loans");
