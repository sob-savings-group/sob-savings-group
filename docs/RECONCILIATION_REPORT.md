# Reconciliation report (READ-ONLY — no record was altered)

Compares the figures the platform would migrate (the JSON data set run through the new engine) with the two source workbooks.
Differences below must be resolved against paper / bank records by SOB before any production migration.

## Totals

| Source | Rows | Savings (typed from Amount + Purpose) | Loan movement | Profit | Header banner |
|---|---|---|---|---|---|
| Platform seed (engine) | 325 | 12,711,303 | — | — | — |
| SOB_DATABASE_.xlsx | 321 | 12,367,303 | -5,861,000 | 165,000 | Savings: 15,952,303 | Net Loans: 5,861,000 | Profit: 165,000 | Total Cash Balance: 6,506,3 |
| SOB_SYSTEM_.xlsx | 330 | 12,711,303 | -5,861,000 | 165,000 | Savings: 16,446,303 | Net Loans: 5,861,000 | Profit: 165,000 | Total Cash Balance: 6,850,3 |

## Per-member savings differences (platform seed vs each workbook)

| Member | Platform | SOB_DATABASE_ | SOB_SYSTEM_ | Diff vs DATABASE | Diff vs SYSTEM |
|---|---|---|---|---|---|
| SOB-002 | 1,201,680 | 1,101,680 | 1,201,680 | +100,000 | +0 |
| SOB-003 | 907,460 | 807,460 | 907,460 | +100,000 | +0 |
| SOB-007 | 193,360 | 343,360 | 193,360 | -150,000 | +0 |
| SOB-008 | 51,952 | 47,952 | 51,952 | +4,000 | +0 |
| SOB-010 | 929,600 | 889,600 | 929,600 | +40,000 | +0 |
| SOB-017 | 2,569,520 | 2,369,520 | 2,569,520 | +200,000 | +0 |
| SOB-055 | 87,503 | 37,503 | 87,503 | +50,000 | +0 |

## Findings
- Platform seed total 12,711,303; SOB_SYSTEM_ 12,711,303 (matches); SOB_DATABASE_ 12,367,303 (DIFFERS).
- Both workbook header banners state different savings totals that match neither ledger: treat the banners as stale text, not as a source of truth.

## Loans

| Loan | Member | Principal | Seed date | Note |
|---|---|---|---|---|
| LOAN-ZD8I81 | SOB-005 | 2,000,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-GI0PEP | SOB-002 | 200,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-PEVR6P | SOB-022 | 200,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-YY8MV1 | SOB-032 | 200,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-PB6TSJ | SOB-015 | 100,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-WKPXQQ | SOB-035 | 1,500,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-51YAL4 | SOB-040 | 100,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-J9KP9M | SOB-025 | 200,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-VH6W0S | SOB-004 | 861,000 | 2025-12-21 | shared placeholder date — confirm |
| LOAN-25TZE8 | SOB-011 | 2,070,000 | 2025-12-21 | shared placeholder date — confirm |

## Decisions needed
- Which workbook (if either) is the authoritative opening position, or neither (use paper records).
- Real disbursement date and approved interest for each loan.
- Any member whose savings differ above: confirm the correct balance from receipts.
- The platform will record agreed corrections as dated, reasoned, audited entries — never by editing history.
