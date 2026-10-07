/* Builds dist/sob-app.html: the production web client as ONE file you can open from your computer (no hosting, no Node).
   It asks once for the deployed /exec URL (remembered in this browser), or take it from ?url=... Contains no data. */
const fs = require("fs"), path = require("path"), { execSync } = require("child_process"), root = path.join(__dirname, "..");
execSync("node " + path.join(root, "build/make-site.js"), { env: Object.assign({}, process.env, { SOB_URL: "" }), stdio: "pipe" });
const site = path.join(root, "dist/site"), css = fs.readFileSync(path.join(site, "styles.css"), "utf8"), js = fs.readFileSync(path.join(site, "app.bundle.js"), "utf8").replace(/<\/script>/g, "<\\/script>");
const cfg = `(function(){var u=null;try{u=new URLSearchParams(location.search).get("url");if(u)localStorage.setItem("sobUrl",u);else u=localStorage.getItem("sobUrl");}catch(e){}
if(!u||!/^https:\\/\\/script\\.google\\.com\\/.+\\/exec(\\?.*)?$|^http:\\/\\/localhost/.test(u)){u=prompt("Paste the SOB web app URL (it ends in /exec)");try{if(u)localStorage.setItem("sobUrl",u);}catch(e){}}
window.SOB_CONFIG={ledgerUrl:u||""};})();`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b1530"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><title>SOB Lifetime Platform</title><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="app"></div><script>${cfg}</script><script>${js}</script></body></html>`;
fs.writeFileSync(path.join(root, "dist/sob-app.html"), html); console.log("built dist/sob-app.html", html.length, "bytes");
