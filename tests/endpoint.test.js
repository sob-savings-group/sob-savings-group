/* The browser <-> Google Apps Script contract, exercised with the REAL client over REAL HTTP: Apps Script answers a POST to /exec with a
   302 redirect to a one-time address that serves the result. Every way Google can answer with HTML instead of JSON is classified in plain words. */
const assert = require("assert"), http = require("http"), fs = require("fs"), vm = require("vm"), path = require("path"), { execSync } = require("child_process");
const Client = require("../src/client/store.js"), root = path.join(__dirname, ".."); let f = 0;
const test = async (n, fn) => { try { await fn(); console.log("  ok  " + n); } catch (e) { f++; process.exitCode = 1; console.log("FAIL  " + n + "\n      " + (e.message || e)); } };
let mode = "json"; const seen = [];
const PAGES = {
  signin: '<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title></head><body>Sign in to continue to Google Apps Script <a href="https://accounts.google.com/ServiceLogin">Sign in</a></body></html>',
  auth: '<!DOCTYPE html><html><head><title>Error</title></head><body>Authorization is required to perform that action.</body></html>',
  script: '<!DOCTYPE html><html><head><title>Error</title></head><body><div>TypeError: Cannot read properties of undefined (reading \'mustChangePin\')</div></body></html>',
  nofile: '<!DOCTYPE html><html><head><title>Page Not Found</title></head><body>Sorry, unable to open the file at present.</body></html>',
  other: '<!DOCTYPE html><html><head><title>Hello</title></head><body>Something else entirely</body></html>'
};
const srv = http.createServer((q, r) => {
  const cors = { "Access-Control-Allow-Origin": "*" }; let b = ""; q.on("data", (c) => (b += c));
  q.on("end", () => {
    seen.push(q.method + " " + q.url.split("?")[0] + " " + (q.headers["content-type"] || ""));
    if (q.url.startsWith("/macros/s/AKfycbxTEST/exec") || q.url.startsWith("/macros/s/AKfycbxTEST/dev")) {
      if (mode === "notfound") { r.writeHead(404, Object.assign({ "Content-Type": "text/html" }, cors)); return r.end(PAGES.nofile); }
      if (mode === "signin" || mode === "auth" || mode === "script" || mode === "other") { r.writeHead(200, Object.assign({ "Content-Type": "text/html" }, cors)); return r.end(PAGES[mode]); }
      r.writeHead(302, { Location: "/macros/echo?user_content_key=abc&mode=" + (q.method === "GET" ? "get" : "post") }); return r.end();   // Apps Script: POST is answered through a redirect
    }
    if (q.url.startsWith("/macros/echo")) { r.writeHead(200, Object.assign({ "Content-Type": "application/json" }, cors)); return r.end(q.url.includes("mode=get") ? JSON.stringify({ ok: true, service: "SOB Ledger", build: "b1" }) : JSON.stringify({ ok: true, token: "T", user: { id: "ADMIN", name: "ADMIN", role: "Admin", mustChangePin: false }, build: "b1" })); }
    r.writeHead(404); r.end("nope");
  });
});
(async () => {
  await new Promise((res) => srv.listen(0, res)); const base = "http://127.0.0.1:" + srv.address().port, ok = base + "/macros/s/AKfycbxTEST/exec";
  const mk = (url) => Client.create({ url: url || ok, fetch: (u, o) => fetch(u, o), session: null });
  await test("a POST answered through Google's 302 redirect signs in (method, text/plain body and redirect handling)", async () => { mode = "json"; seen.length = 0; const s = mk(), u = await s.login("ADMIN", "x"); assert.equal(u.role, "Admin"); assert.equal(s.serverBuild, "b1"); assert.ok(seen[0].startsWith("POST ") && /text\/plain/.test(seen[0]), seen[0]); assert.ok(seen.some((x) => x.startsWith("GET /macros/echo")), "redirect followed"); });
  const cases = [["signin", "ENDPOINT_NOT_PUBLIC", /Who has access: Anyone/], ["auth", "ENDPOINT_NEEDS_PERMISSION", /authorizeSOB/], ["script", "ENDPOINT_SCRIPT_ERROR", /mustChangePin/], ["notfound", "ENDPOINT_NOT_FOUND", /could not find/], ["other", "ENDPOINT_HTML", /instead of data/]];
  for (const [m, code, re] of cases) await test("HTML answer '" + m + "' becomes " + code + " with an actionable message, never a JSON parse error", async () => {
    mode = m; let err; try { await mk().login("ADMIN", "x"); } catch (e) { err = e; } assert.ok(err, "should fail"); assert.equal(err.code, code); assert.ok(re.test(err.message), err.message); assert.ok(!/Unexpected token/.test(err.message)); });
  await test("a /dev (test) address is named as such", async () => { mode = "other"; let err; try { await mk(base + "/macros/s/AKfycbxTEST/dev").login("A", "b"); } catch (e) { err = e; } assert.equal(err.code, "ENDPOINT_TEST_URL"); });
  await test("an unreachable address is a NETWORK error in words", async () => { let err; try { await mk("http://127.0.0.1:9/macros/s/x/exec").login("A", "b"); } catch (e) { err = e; } assert.equal(err.code, "NETWORK"); assert.ok(/could not reach Google/.test(err.message)); });
  await test("check(): reachable SOB endpoint reports its build; HTML and non-SOB answers are classified", async () => { mode = "json"; const r = await mk().check(); assert.ok(r.ok); assert.equal(r.build, "b1"); mode = "signin"; const r2 = await mk().check(); assert.ok(!r2.ok); assert.equal(r2.error.code, "ENDPOINT_NOT_PUBLIC"); });
  await test("the Apps Script entry point answers JSON even when something throws outside the handler (never Google's HTML error page)", () => {
    execSync("node " + path.join(root, "build/build-gs.js")); const src = fs.readFileSync(path.join(root, "dist/Code_Ledger.gs"), "utf8");
    const sb = { LockService: { getScriptLock() { throw new Error("Lock service is unavailable"); } }, SpreadsheetApp: { getActiveSpreadsheet: () => null }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) }, console };
    vm.createContext(sb); vm.runInContext(src + "\nthis.doPost=doPost;this.doGet=doGet;this.authorizeSOB=authorizeSOB;", sb);
    const out = JSON.parse(sb.doPost({ postData: { contents: JSON.stringify({ action: "login", id: "A", pin: "b" }) } }).s); assert.equal(out.ok, false); assert.ok(/^SERVER_ERROR: Lock service/.test(out.error)); assert.ok(out.build);
    const g = JSON.parse(sb.doGet().s); assert.equal(g.service, "SOB Ledger"); assert.equal(g.build, out.build); assert.ok(/authorizeSOB/.test(src));
    assert.equal(JSON.parse(sb.doPost({ postData: { contents: "<not json" } }).s).ok, false);
  });
  srv.close(); if (f) process.exit(1); console.log("endpoint contract tests passed");
})();
