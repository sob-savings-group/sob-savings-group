/* One build id shared by the Apps Script bundle and the web app, so the app can tell when the deployed Google backend is older than it. */
const fs = require("fs"), path = require("path"), crypto = require("crypto"), root = path.join(__dirname, "..");
function buildId() {
  const h = crypto.createHash("sha1");
  ["src/core", "src/backend"].forEach((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js")).sort().forEach((f) => { h.update(f); h.update(fs.readFileSync(path.join(root, d, f))); }));
  return h.digest("hex").slice(0, 10);
}
module.exports = { buildId };
