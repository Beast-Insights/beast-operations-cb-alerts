# Alerts Operations Dashboard - Context Document

## Project
- **Location**: `/Users/sagarrabadia/Downloads/ACTIVE PROJECTS/alerts-operations-dashboard/`
- **Stack**: Next.js 14 + TypeScript + Tailwind + Recharts + TanStack Table
- **Local server**: Port 3030
- **DB**: PostgreSQL on `db.beastinsights.com` (Azure)

## Database Access
- **Read-only user**: `beastinsights_ro`, DB `postgres` — credentials in `.env.local` (gitignored), see `.env.example`.
- **Write user** (only for `public.chargebacks_raw`): `beastinsights_api` — credentials managed out-of-band, never committed.
- **Table**: `data.alerts_raw` — all alert data
- **Key columns**: `alert_id`, `alert_type`, `alert_timestamp` (EST), `created_at` (UTC), `merchant_descriptor`, `post_alert_status`, `transaction_amount`, `card_bin`, `order_id`, `gateway_name`
- **Alert types**: `CDRN`, `RDR`, `issuer_alert` (Ethoca), `customerdispute_alert` (Ethoca)

## Disputifier (Alerts Provider)
- Provides **CDRN and RDR** alerts (not Ethoca)
- Agreed rate: **$11/alert**
- Invoices are weekly, billed in arrears

## Closed/Disabled Descriptors (should NOT be billed)
These CDRN descriptors are closed. Alerts from these should be excluded from billing:
- MyPowerHut / MYPOWERHUT
- Chef-Station / CHEF-STATION
- SerelyStore / SERELYSTORE / SERELY STORE
- BuyShuffle / BUYSHUFFLE / BUYSHUFFLE.COM
- Horizon-Lane / HORIZON-LANE
- MyShuffleDeals / MYSHUFFLEDEALS / MYSHUFFLEDEALS.COM
- Borella Boutique / BRLBOUTIQUE (closed from March 21, 2026 only)

**Note**: BRL BOUTIQUE is a different, active descriptor — NOT the same as Borella Boutique.

## 8 Disputifier Invoices Summary

| Invoice | Period | CDRN | RDR | Total | Rate | Subtotal | Credits | Amount Due |
|---|---|---|---|---|---|---|---|---|
| 0006 | 01/30 – 02/05 | 13 | 2 | 15 | $11 | $165 | — | $165 |
| 0007 | 02/06 – 02/12 | 125 | 129 | 254 | $11 | $2,794 | — | $2,794 |
| 0008 | 02/13 – 02/19 | 181 | 68 | 249 | $11 | $2,739 | — | $2,739 |
| 0009 | 02/20 – 02/26 | 213 | 57 | 270 | $11 | $2,970 | — | $2,970 |
| 0015 | 02/27 – 03/05 | 153 | 87 | 240 | $13 | $3,120 | -$2,262 | $858 |
| 0016 | 03/06 – 03/12 | 114 | 61 | 175 | $13 | $2,275 | -$1,638 | $637 |
| 0018 | 03/13 – 03/19 | 32 | 38 | 70 | $11 | $770 | -$770 | $0 |
| 0019 | 03/20 – 03/26 | 37 | 18 | 55 | $13 | $715 | -$60 | $655 |

### Key Invoice Issues
1. **Pricing**: Invoices 0015, 0016, 0019 billed at $13 instead of agreed $11
2. **Credits on 0018 ($770) and 0019 ($60)**: These were for the $2/alert price difference on invoices 0015 and 0016 (240+175=415 alerts x $2 = $830). NOT for closed descriptors.
3. **Invoice 0007 discrepancy**: Billed 19 more RDR and 2 more CDRN than exist in their own CSV export and our DB

## Overbilling Analysis (Invoices 0018 & 0019)

### Invoice 0018 (03/13 – 03/19)
- **CDRN**: Billed 32, DB has 72, 52 from closed descriptors, **20 billable**, overbilled 12
- **RDR**: Billed 38, **should bill 8**, overbilled 30
- Overbilled amount: 42 x $11 = **$462**

### Invoice 0019 (03/20 – 03/26)
- **CDRN**: Billed 37, DB has 37, 15 from closed descriptors, **22 billable**, overbilled 15
- **RDR**: Billed 18, **should bill 6**, overbilled 12
- Overbilled amount: 27 x $13 = **$351**

## Balance Disputifier Owes Us
| Item | Amount |
|---|---|
| Overbilled on 0018 (42 alerts x $11) | $462 |
| Overbilled on 0019 (27 alerts x $13) | $351 |
| Price difference on 0015/0016 (415 x $2) | $830 |
| **Total credits owed** | **$1,643** |
| Credits already applied (-$770 on 0018, -$60 on 0019) | -$830 |
| **Balance owed to us** | **$813** |

## Google Sheet for Tracking
- **Sheet ID**: `1U67L7oIgpyEASDpQw_FkZeoBirJOLb1cDHdmzgdiQzQ`
- **"today" tab**: Invoice review summary (overbilled analysis)
- **"Sheet7" tab**: All 109 CDRN + 56 RDR alert details with Billable (Yes/No) column
- **Google account**: `sagar@sranalytics.io`

## Weekly Billing Workflow (Every Monday)
1. Query `data.alerts_raw` for previous week (Mon-Sun) by `alert_timestamp`
2. Get counts by `alert_type` (CDRN, RDR, issuer_alert, customerdispute_alert)
3. Check how many CDRN came from closed descriptors
4. Billable = Total - Closed descriptor alerts
5. Ethoca = issuer_alert + customerdispute_alert (combined)

### SQL Template for Weekly Billing
```sql
-- Alert counts by type
SELECT alert_type, COUNT(*) FROM data.alerts_raw
WHERE alert_timestamp >= 'YYYY-MM-DD' AND alert_timestamp < 'YYYY-MM-DD'
GROUP BY alert_type ORDER BY count DESC;

-- Closed descriptor CDRN
SELECT merchant_descriptor, COUNT(*) FROM data.alerts_raw
WHERE alert_type = 'CDRN'
  AND alert_timestamp >= 'YYYY-MM-DD' AND alert_timestamp < 'YYYY-MM-DD'
  AND (
    LOWER(merchant_descriptor) LIKE '%mypowerhut%'
    OR LOWER(merchant_descriptor) LIKE '%chef-station%'
    OR LOWER(merchant_descriptor) LIKE '%serelystore%'
    OR LOWER(merchant_descriptor) LIKE '%serely store%'
    OR LOWER(merchant_descriptor) LIKE '%buyshuffle%'
    OR LOWER(merchant_descriptor) LIKE '%horizon-lane%'
    OR LOWER(merchant_descriptor) LIKE '%myshuffledeals%'
    OR LOWER(merchant_descriptor) LIKE '%borella%'
    OR LOWER(merchant_descriptor) LIKE '%brlboutique%'
  )
GROUP BY merchant_descriptor ORDER BY count DESC;
```

## Recent Weekly Billing Results

### Mar 23 – 29, 2026
| Type | Count | Closed | Billable |
|---|---|---|---|
| CDRN | 30 | 6 (BuyShuffle 4, MyPowerHut 2) | 24 |
| RDR | 22 | 0 | 22 |
| Ethoca | 43 | 0 | 43 |
| **Total** | **95** | **6** | **89** |

### Mar 30 – Apr 5, 2026
| Type | Count | Closed | Billable |
|---|---|---|---|
| CDRN | 33 | 5 (MyPowerHut 4, BuyShuffle 1) | 28 |
| RDR | 51 | 0 | 51 |
| Ethoca | 55 | 0 | 55 |
| **Total** | **139** | **5** | **134** |

### Apr 6 – 12, 2026
| Type | Count | Closed | Billable |
|---|---|---|---|
| CDRN | 19 | 1 (MyPowerHut 1) | 18 |
| RDR | 26 | 0 | 26 |
| Ethoca | 26 | 0 | 26 |
| **Total** | **71** | **1** | **70** |

### Apr 13 – 19, 2026
| Type | Count | Closed | Billable |
|---|---|---|---|
| CDRN | 19 | 1 (BuyShuffle 1) | 18 |
| RDR | 19 | 0 | 19 |
| Ethoca | 41 | 0 | 41 |
| **Total** | **79** | **1** | **78** |
