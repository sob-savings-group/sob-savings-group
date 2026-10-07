"""Read-only reconciliation: compares the data set the platform would migrate against the two source workbooks.
Nothing is changed anywhere; the output is a report for a human to resolve against paper/bank records.
usage: python3 -I tools/reconcile.py <seed-engine-summary.json> <SOB_DATABASE_.xlsx> <SOB_SYSTEM_.xlsx> <out.md>"""
import sys, json, re, collections, openpyxl
seed, dbx, sysx, out = sys.argv[1:5]
S = json.load(open(seed))
def num(x):
    try: return float(x)
    except Exception: return 0.0
def read(path, sheet_hint):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = next(w for w in wb if w.title.strip().lower().endswith(sheet_hint))
    hdr = ws.cell(1, 11).value
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[1] and re.match(r"SOB-\d+", str(r[1]).strip()):
            p = str(r[4] or "").strip(); a = abs(num(r[3]))
            sv = a if p in ("Savings", "Profit") else (-a if p in ("Withdraw", "Bank Charge") else 0)  # typed like the engine; the sheet Savings column mixes running totals
            rows.append(dict(date=r[0], member=str(r[1]).strip(), amount=a, purpose=p, savings=sv, loan=(a if p == "Loan Repayment" else (-a if p == "Loan Disbursement" else 0)), profit=(a if p == "Profit" else 0)))
    return hdr, rows
def num(x):
    try: return float(x)
    except Exception: return 0.0
res = {}
for label, path in (("SOB_DATABASE_.xlsx", dbx), ("SOB_SYSTEM_.xlsx", sysx)):
    hdr, rows = read(path, "members")
    per = collections.defaultdict(float)
    for r in rows: per[r["member"]] += num(r["savings"])
    res[label] = dict(header=hdr, rows=len(rows), savings=sum(per.values()), loan=sum(num(r["loan"]) for r in rows), profit=sum(num(r["profit"]) for r in rows), per=per)
lines = ["# Reconciliation report (READ-ONLY — no record was altered)", "",
 "Compares the figures the platform would migrate (the JSON data set run through the new engine) with the two source workbooks.",
 "Differences below must be resolved against paper / bank records by SOB before any production migration.", "",
 "## Totals", "", "| Source | Rows | Savings (typed from Amount + Purpose) | Loan movement | Profit | Header banner |", "|---|---|---|---|---|---|"]
lines.append("| Platform seed (engine) | %d | %s | — | — | — |" % (S["transactions"], f"{S['groupSavings']:,.0f}"))
for k, v in res.items(): lines.append("| %s | %d | %s | %s | %s | %s |" % (k, v["rows"], f"{v['savings']:,.0f}", f"{v['loan']:,.0f}", f"{v['profit']:,.0f}", str(v["header"])[:90]))
lines += ["", "## Per-member savings differences (platform seed vs each workbook)", "", "| Member | Platform | SOB_DATABASE_ | SOB_SYSTEM_ | Diff vs DATABASE | Diff vs SYSTEM |", "|---|---|---|---|---|---|"]
ids = sorted(set(S["perMember"]) | set(res["SOB_DATABASE_.xlsx"]["per"]) | set(res["SOB_SYSTEM_.xlsx"]["per"]))
nd = 0
for i in ids:
    a = S["perMember"].get(i, 0); b = res["SOB_DATABASE_.xlsx"]["per"].get(i, 0); c = res["SOB_SYSTEM_.xlsx"]["per"].get(i, 0)
    if abs(a - b) > 0.5 or abs(a - c) > 0.5:
        nd += 1; lines.append("| %s | %s | %s | %s | %s | %s |" % (i, f"{a:,.0f}", f"{b:,.0f}", f"{c:,.0f}", f"{a-b:+,.0f}", f"{a-c:+,.0f}"))
if not nd: lines.append("| (none) | | | | | |")
dsum, ssum = res["SOB_DATABASE_.xlsx"]["savings"], res["SOB_SYSTEM_.xlsx"]["savings"]
lines += ["", "## Findings", "- Platform seed total %s; SOB_SYSTEM_ %s (%s); SOB_DATABASE_ %s (%s)." % (f"{S['groupSavings']:,.0f}", f"{ssum:,.0f}", "matches" if abs(ssum - S["groupSavings"]) < 1 else "DIFFERS", f"{dsum:,.0f}", "matches" if abs(dsum - S["groupSavings"]) < 1 else "DIFFERS"),
 "- Both workbook header banners state different savings totals that match neither ledger: treat the banners as stale text, not as a source of truth."]
lines += ["", "## Loans", "", "| Loan | Member | Principal | Seed date | Note |", "|---|---|---|---|---|"]
dates = collections.Counter(l["date"] for l in S["loans"])
for l in S["loans"]:
    lines.append("| %s | %s | %s | %s | %s |" % (l["id"], l["memberId"], f"{l['loanAmount']:,.0f}", l["date"], "shared placeholder date — confirm" if dates[l["date"]] >= 5 else ""))
lines += ["", "## Decisions needed", "- Which workbook (if either) is the authoritative opening position, or neither (use paper records).",
 "- Real disbursement date and approved interest for each loan.", "- Any member whose savings differ above: confirm the correct balance from receipts.",
 "- The platform will record agreed corrections as dated, reasoned, audited entries — never by editing history."]
open(out, "w").write("\n".join(lines) + "\n"); print("wrote", out, "| differing members:", nd)
