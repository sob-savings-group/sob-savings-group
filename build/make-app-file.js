/* Builds dist/sob-app.html: the production web client as ONE file (no hosting, no Node needed to use it).
   The production Apps Script /exec URL is BUILT IN, so members just open the file and see the sign-in screen.
   URL source, in order: env SOB_URL, then config/production-url.txt (gitignored; one line). It contains no data.
   Developer/test override (never needed by members): open the file with ?dev=<exec URL or http://localhost...>;
   it applies to that page load only and is never remembered. */
const fs = require("fs"), path = require("path"), { execSync } = require("child_process"), root = path.join(__dirname, "..");
const EXEC = /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;   // normal and Google Workspace address forms
let prod = (process.env.SOB_URL || "").trim();
if (!prod) { try { prod = fs.readFileSync(path.join(root, "config/production-url.txt"), "utf8").trim(); } catch (e) {} }
if (prod && !EXEC.test(prod)) { console.error("SOB_URL / config/production-url.txt is not a valid Apps Script /exec URL"); process.exit(1); }
execSync("node " + path.join(root, "build/make-site.js"), { env: Object.assign({}, process.env, { SOB_URL: "" }), stdio: "pipe" });
const site = path.join(root, "dist/site"), css = fs.readFileSync(path.join(site, "styles.css"), "utf8"), js = fs.readFileSync(path.join(site, "app.bundle.js"), "utf8").replace(/<\/script>/g, "<\\/script>");
const cfg = `(function(){var u=${JSON.stringify(prod)};try{var d=new URLSearchParams(location.search).get("dev");if(d&&/^https:\\/\\/script\\.google\\.com\\/(a\\/macros\\/[A-Za-z0-9.-]+|macros)\\/s\\/[A-Za-z0-9_-]+\\/exec$|^http:\\/\\/localhost(:\\d+)?\\//.test(d))u=d;}catch(e){}
try{localStorage.removeItem("sobUrl");}catch(e){}
window.SOB_DEMO_NAMES=${JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, "app/demo-seed.json"), "utf8")).members.map((m) => m.name))};
window.SOB_CONFIG={ledgerUrl:u,notConfigured:!u,build:${JSON.stringify(require("./common.js").buildId())}};})();`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><title>SOB Lifetime Platform</title><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="app"></div><script>${cfg}</script><script>${js}</script></body></html>`;
fs.writeFileSync(path.join(root, "dist/sob-app.html"), html); console.log("built dist/sob-app.html", html.length, "bytes");
