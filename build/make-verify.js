/* Builds dist/verify.html: ONE self-contained page that runs the deployment checks from a browser (no Node needed). Contains no data. */
const fs = require("fs"), path = require("path"), root = path.join(__dirname, ".."), html = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const core = [...html.matchAll(/<script src="\.\.\/(src\/core\/[^"]+)"><\/script>/g)].map((m) => m[1]);
const js = core.map((f) => "/* " + f + " */\n" + fs.readFileSync(path.join(root, f), "utf8")).join("\n") + "\n" + fs.readFileSync(path.join(root, "tools/web-verify.js"), "utf8");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOB deployment check</title>
<style>body{font:15px system-ui,sans-serif;max-width:760px;margin:16px auto;padding:0 16px;line-height:1.4}label{display:block;margin:10px 0 2px;font-weight:600}input[type=text],input[type=password]{width:100%;padding:8px;box-sizing:border-box}button{padding:9px 14px;margin:8px 6px 0 0;font-size:15px}pre{background:#111;color:#eee;padding:12px;overflow:auto;white-space:pre-wrap;min-height:80px}fieldset{margin:14px 0;border:1px solid #bbb}small{color:#555}</style></head><body>
<h1>SOB deployment check</h1><p>Runs the same checks as <code>sobctl smoke</code> against your deployed web app. Nothing is stored; PINs stay in this tab.</p>
<label>Web app URL (ends in /exec)</label><input id="url" type="text" placeholder="https://script.google.com/macros/s/.../exec">
<label>Admin ID</label><input id="aid" type="text" value="ADMIN"><label>Admin PIN</label><input id="apin" type="password">
<button id="b-smoke">1. Run smoke check (safe, read-only)</button>
<fieldset><legend>2. Write test (SCRATCH deployment only)</legend><small>Needs a Chairperson, because the Super Admin's void must be approved by someone else.</small>
<label>Chairperson ID</label><input id="cid" type="text" value="CHAIR"><label>Chairperson starting PIN (6+ characters)</label><input id="cslip" type="password"><label>Chairperson's own new PIN (4+ characters, used once)</label><input id="cown" type="password">
<button id="b-chair">2a. Create Chairperson sign-in</button><br><label><input id="scratch" type="checkbox"> This is a scratch deployment, not production</label><button id="b-write">2b. Run write test</button></fieldset>
<button id="b-copy">Copy results</button><pre id="out">Results appear here.</pre><script>${js.replace(/<\/script>/g, "<\\/script>")}</script></body></html>`;
fs.writeFileSync(path.join(root, "dist/verify.html"), page); console.log("built dist/verify.html", page.length, "bytes");
