/* Brand: every printable carries BOTH logos (official eagle/globe + shield-and-tree); index has icons + manifest; app has the shared lockup. */
const fs = require("fs"), path = require("path"), assert = require("assert"), root = path.join(__dirname, "..");
const R = require("../src/core/reports.js");
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
t("both logos are exported and are real images", () => { assert(/^data:image\/jpeg;base64,/.test(R.LOGO)); assert(/^data:image\/jpeg;base64,/.test(R.SHIELD)); assert.notStrictEqual(R.LOGO, R.SHIELD); });
t("the branded printable letterhead holds the eagle first, then the shield", () => {
  const html = R.brandedPage("Test report", "<p>x</p>", { period: "p", generated: "g" });
  const imgs = [...html.matchAll(/<div class="hd">(.*?)<div class="t">/g)][0][1];
  assert(imgs.includes(R.LOGO) && imgs.includes(R.SHIELD)); assert(imgs.indexOf(R.LOGO) < imgs.indexOf(R.SHIELD));
});
t("index.html links favicon, touch icon, manifest and loads the brand marks", () => {
  const h = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
  ["rel=\"icon\"", "apple-touch-icon", "manifest.webmanifest", "brand.js"].forEach((k) => assert(h.includes(k), k));
  ["icon-32", "icon-180", "icon-192", "icon-512"].forEach((f) => assert(fs.existsSync(path.join(root, "app/icons", f + ".png")), f));
});
t("every screen logo goes through the one lockup (no stray single-logo images)", () => {
  const a = fs.readFileSync(path.join(root, "app/app.js"), "utf8");
  assert.strictEqual((a.match(/src: R\.LOGO/g) || []).length, 1, "R.LOGO must appear only inside brandMark");
  assert(a.includes("brandMark(\"sm\")") && a.includes("brandMark(\"lg\")") && a.includes("splash()"));
});
console.log(n + " brand tests passed");
