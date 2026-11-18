/* SOB client/xlsx — writes a real Excel workbook (.xlsx) from a report, in the browser, with no library.
   One sheet: group name, report title, period, a header row, the data (numbers stay numbers, so Excel can sum and sort them), and a totals row.
   Strings are stored as text and never as formulas, so nothing a member typed can run when the file is opened. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else { root.SOB = root.SOB || {}; root.SOB.xlsx = api; }
})(typeof self !== "undefined" ? self : this, function () {
  const enc = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  /* a ZIP with every file stored (no compression): valid for Excel, and tiny code */
  function zip(files) {
    const out = [], central = []; let off = 0;
    files.forEach(([name, text]) => {
      const nb = enc(name), data = enc(text), crc = crc32(data);
      const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
      out.push(Uint8Array.from(head), nb, data);
      central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += head.length + nb.length + data.length;
    });
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
    const all = out.concat(central, [end]), total = all.reduce((a, b) => a + b.length, 0), buf = new Uint8Array(total); let p = 0; all.forEach((b) => { buf.set(b, p); p += b.length; }); return buf;
  }
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  /* styles: 1 title, 2 header, 3 number, 4 total label, 5 total number, 6 note, 7 text */
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0;[Red]\(#,##0\)"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red]\(#,##0.00\)"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF14202E"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6A6254"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF14202E"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4EAD0"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FFA8812F"/></top><bottom style="double"><color rgb="FFA8812F"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" wrapText="1" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
  function sheetXml(rep, meta) {
    const rows = []; let r = 0; const cell = (c, v, s) => { const ref = colName(c) + r; return typeof v === "number" && isFinite(v) ? '<c r="' + ref + '" s="' + s + '"><v>' + v + "</v></c>" : '<c r="' + ref + '" s="' + ((s === 3 || s === 9) ? 7 : s) + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v == null ? "" : v) + "</t></is></c>"; };
    const line = (cells, h) => { r++; rows.push('<row r="' + r + '"' + (h ? ' ht="' + h + '" customHeight="1"' : "") + ">" + cells.map(([c, v, s]) => cell(c, v, s)).join("") + "</row>"); };
    const cols = rep.columns, label = (c) => (rep.labels && rep.labels[c]) || String(c).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase());
    line([[0, meta.group || "Sons of Bethel (SOB) Savings Group", 1]]); line([[0, rep.title, 1]]); if (rep.period) line([[0, "Period: " + rep.period, 6]]); line([[0, "Prepared: " + (meta.generated || ""), 6]]); line([]);
    const numCol = cols.map((c) => rep.rows.length > 0 && rep.rows.every((x) => x[c] === "" || x[c] == null || typeof x[c] === "number"));
    const decCol = cols.map((c, i) => numCol[i] && rep.rows.some((x) => typeof x[c] === "number" && Math.round(x[c]) !== x[c]));
    line(cols.map((c, i) => [i, label(c), numCol[i] ? 8 : 2]), 30);
    rep.rows.forEach((x) => line(cols.map((c, i) => [i, numCol[i] ? (x[c] === "" || x[c] == null ? "" : x[c]) : x[c], numCol[i] ? (decCol[i] ? 9 : 3) : 0])));
    const tk = Object.keys(rep.totals || {}).filter((k) => cols.includes(k) && typeof rep.totals[k] === "number");
    if (tk.length && rep.rows.length) line(cols.map((c, i) => (i === 0 ? [i, "Total", 4] : tk.includes(c) ? [i, rep.totals[c], 5] : [i, "", 4])));
    (rep.notes || []).forEach((n) => line([[0, n, 6]]));
    const widths = cols.map((c, i) => Math.min(48, Math.max(12, String(label(c)).length + 2, ...rep.rows.slice(0, 200).map((x) => String(x[c] == null ? "" : typeof x[c] === "number" ? x[c].toLocaleString("en-US") : x[c]).length + 2))));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols><sheetData>" + rows.join("") + "</sheetData><pageSetup orientation=\"landscape\" fitToHeight=\"0\"/></worksheet>";
  }
  function build(rep, meta) {
    meta = meta || {}; const name = esc(String(rep.title || "Report").replace(/[\\\/?*\[\]:]/g, " ").slice(0, 31));
    return zip([
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ["xl/styles.xml", STYLES], ["xl/worksheets/sheet1.xml", sheetXml(rep, meta)]]);
  }
  return { build, crc32 };
});
