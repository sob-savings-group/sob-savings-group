"""Extract the dated transaction rows of a SOB workbook (sheet ending 'members') to JSON. Read-only.
usage: python3 -I tools/extract-workbook.py <workbook.xlsx> > rows.json"""
import sys, json, re, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = next(w for w in wb if w.title.strip().lower().endswith("members"))
rows = []
for n, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if r[1] and re.match(r"SOB-\d+", str(r[1]).strip()) and hasattr(r[0], "date"):
        try: amt = abs(float(r[3] or 0))
        except Exception: amt = 0.0
        rows.append({"row": n, "date": r[0].date().isoformat(), "memberId": str(r[1]).strip(), "amount": amt, "type": str(r[4] or "").strip()})
admin = []
wa = next((w for w in wb if "dministration" in w.title), None)
if wa is not None:
    for n, r in enumerate(wa.iter_rows(min_row=2, values_only=True), start=2):
        if r[7] and re.match(r"SOB-\d+", str(r[7]).strip()) and hasattr(r[0], "date"):
            try: amt = abs(float(r[1] or 0))
            except Exception: amt = 0.0
            admin.append({"row": n, "date": r[0].date().isoformat(), "memberId": str(r[7]).strip(), "amount": amt, "purpose": str(r[6] or "").strip(), "bankedBy": str(r[2] or "")})
print(json.dumps({"file": sys.argv[1].split("/")[-1], "banner": str(ws.cell(1, 11).value or ""), "rows": rows, "admin": admin}))
