# Internal Operations Monitoring Dashboard - Design Plan

## Executive Summary
This document outlines the design for a world-class internal operational monitoring dashboard for RDR, CDRN, and Ethoca alert processing. The goal is to provide real-time visibility into every step of the alert lifecycle, identify bottlenecks immediately, and ensure no alert falls through the cracks.

---

## 1. Critical SLAs & Time Windows

Based on industry research and your data, these are the critical SLAs we must monitor:

| Alert Type | Response Window | Credit Eligibility | Auto/Manual |
|------------|-----------------|-------------------|-------------|
| **Ethoca** | 24 hours | Must respond within 24h | Manual refund |
| **CDRN** | 72 hours | Must respond within 72h | Manual refund |
| **RDR** | Automatic | Immediate | Automatic refund |

**Current Issues Detected in Your Data:**
- 276 issuer_alerts and 91 customerdispute_alerts are >72 hours old (CRITICAL)
- 45 issuer_alerts pending refund initiation (>2h)
- 15 issuer_alerts pending CRM confirmation (>4h)

---

## 2. Dashboard Sections (5 Core Modules)

### Module 1: Real-Time Health Overview (Top Banner)
**Purpose:** At-a-glance system health - is everything working?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SYSTEM HEALTH                                            Last Updated: Now  │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────┤
│   INGESTION  │  PROCESSING  │    SLA       │   BACKLOG    │    ERRORS      │
│   ● HEALTHY  │  ● WARNING   │  ● CRITICAL  │  ● HEALTHY   │   ● HEALTHY    │
│   143/hr     │  12 pending  │  367 >72h    │  0 stuck     │   0 failures   │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────────┘
```

**Metrics:**
- **Ingestion Status:** Alerts received in last hour vs expected rate
- **Processing Status:** Alerts pending action in pipeline
- **SLA Status:** Alerts approaching or breaching SLA windows
- **Backlog Status:** Alerts stuck at any processing step
- **Error Status:** API failures, CRM sync errors, etc.

**Alert Thresholds:**
- 🟢 Green: All systems normal
- 🟡 Yellow: 1+ alerts approaching SLA (50% of window used)
- 🔴 Red: 1+ alerts breaching SLA or system errors

---

### Module 2: Ingestion Monitor (Data Source Health)
**Purpose:** Ensure we're receiving alerts from all sources in real-time

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ DATA INGESTION - Last 24 Hours                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Source          Provider      Type        Last Alert    Rate/Hr   Status  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  ethoca_api      Altopay      issuer       2 min ago     12.8     ● LIVE   │
│  ethoca_api      Altopay      customer     5 min ago     4.4      ● LIVE   │
│  disputifier     Disputifier  CDRN         15 min ago    2.4      ● LIVE   │
│  disputifier     Disputifier  RDR          18 min ago    2.4      ● LIVE   │
│                                                                             │
│  [Hourly Volume Chart - Sparkline showing last 24h pattern]                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Metrics:**
- Time since last alert from each source (detect gaps)
- Hourly alert volume vs historical average
- Alert volume trend (increasing/decreasing)
- Source-specific error rates

**Alert Triggers:**
- No alert from a source for 30+ minutes during business hours
- Volume drop >50% from hourly average
- API connection failures

---

### Module 3: Processing Pipeline (Real-Time Workflow Status)
**Purpose:** Track every alert through the processing stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PROCESSING PIPELINE - All Alert Types                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────┐ │
│  │ RECEIVED │───▶│ ORDER    │───▶│ REFUND   │───▶│ CRM      │───▶│ ACK/ │ │
│  │          │    │ MATCH    │    │ INIT     │    │ CONFIRM  │    │CLOSE │ │
│  │   529    │    │   461    │    │   409    │    │   372    │    │  372 │ │
│  │  100%    │    │   87%    │    │   77%    │    │   70%    │    │  70% │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────┘ │
│                       │               │               │                    │
│                       ▼               ▼               ▼                    │
│                  ┌─────────┐    ┌─────────┐    ┌─────────┐                │
│                  │ INVALID │    │ PENDING │    │ PENDING │                │
│                  │   68    │    │   52    │    │   37    │                │
│                  │  (13%)  │    │  (10%)  │    │  (7%)   │                │
│                  └─────────┘    └─────────┘    └─────────┘                │
│                                                                             │
│  BOTTLENECK DETECTED: 52 alerts stuck at Refund Init stage (avg 3.2h)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Separate Views for Each Alert Type:**
- **RDR Pipeline:** Received → Order Match → Already Refunded? → Blacklisted?
- **CDRN Pipeline:** Received → Order Match → Refund Init → CRM Confirm → Effective
- **Ethoca Pipeline:** Received → Order Match → Refund Init → CRM Confirm → Acknowledge → Close

**Key Metrics per Stage:**
- Count of alerts at each stage
- Average time in stage
- Alerts exceeding expected time in stage
- Drop-off rate between stages

---

### Module 4: SLA Countdown & Risk Monitor
**Purpose:** Never miss an SLA - proactive warning system

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SLA RISK MONITOR                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔴 CRITICAL (SLA Breached)           │  🟡 WARNING (50%+ time elapsed)     │
│  ─────────────────────────────────────┼───────────────────────────────────  │
│  367 Ethoca alerts >24h               │  23 Ethoca alerts 12-24h remaining  │
│  Total Value: $4,037                  │  Total Value: $253                  │
│  [View All] [Export]                  │  [View All]                         │
│                                       │                                     │
│                                       │  🟢 HEALTHY (<50% time elapsed)     │
│                                       │  ─────────────────────────────────  │
│                                       │  139 alerts on track                │
│                                       │                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  COUNTDOWN QUEUE (Oldest First - Need Immediate Action)                     │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Alert ID          Type      Age       SLA Left    Amount   Action Needed   │
│  40XJWKHE...       Ethoca    84h       BREACHED    $29.99   Close case     │
│  7E2HPJ2Q...       Ethoca    75h       BREACHED    $29.99   CRM confirm    │
│  BGXG63GS...       Ethoca    73h       BREACHED    $29.99   CRM confirm    │
│  9KN4U7LH...       Ethoca    5h        19h left    $29.00   Acknowledge    │
│  ...                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- Real-time SLA countdown for every alert
- Grouped by risk level (Critical/Warning/Healthy)
- Sortable by time remaining, amount, alert type
- Direct action buttons (link to processing system)
- Estimated credit at risk if SLA breached

---

### Module 5: Operations Metrics & Trends
**Purpose:** Track operational efficiency over time

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ OPERATIONS METRICS                                        Period: Last 7d   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  KEY PERFORMANCE INDICATORS                                                 │
│  ┌────────────────┬────────────────┬────────────────┬────────────────┐     │
│  │ MTTD           │ MTTR           │ SLA Compliance │ Effectiveness  │     │
│  │ 0.5h           │ 3.2h           │ 72%            │ 70%            │     │
│  │ ▼ 0.1h         │ ▲ 0.8h         │ ▼ 5%           │ ─ 0%           │     │
│  └────────────────┴────────────────┴────────────────┴────────────────┘     │
│                                                                             │
│  VOLUME & PROCESSING TRENDS (Hourly)                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │    ^                                                                │   │
│  │ 50 │        ╭─╮     ╭──╮                    ╭─╮                     │   │
│  │    │   ╭──╮ │ │ ╭─╮ │  │╭─╮               ╭╯ ╰╮    ╭─╮            │   │
│  │ 25 │╭─╮│  ╰─╯ ╰─╯ ╰─╯  ╰╯ ╰──────────────╯    ╰────╯ ╰───        │   │
│  │    ││ ╰╯                                                           │   │
│  │  0 │└────────────────────────────────────────────────────────────  │   │
│  │    0h   3h   6h   9h   12h  15h  18h  21h  24h                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ── Received  ── Processed  ── SLA Breached                                 │
│                                                                             │
│  PROCESSING TIME BREAKDOWN                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Order Matching:    ████████ 0.5h avg                                │   │
│  │ Refund Init:       ████████████████ 2.3h avg                        │   │
│  │ CRM Confirmation:  ████ 0.2h avg                                    │   │
│  │ Acknowledgment:    ██████ 0.4h avg                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Metrics:**
- **MTTD (Mean Time to Detect):** How quickly we identify new alerts
- **MTTR (Mean Time to Resolve):** Average alert processing time
- **SLA Compliance Rate:** % of alerts processed within SLA window
- **Effectiveness Rate:** % of alerts that successfully prevented chargebacks
- **Processing Stage Duration:** Time spent at each workflow stage
- **Drop-off Analysis:** Where alerts fail in the pipeline

---

## 3. Alert Type Specific Dashboards

### 3.1 RDR Operations View
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ RDR OPERATIONS                                            Source: Disputifier│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TODAY'S SNAPSHOT                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Received │  │ Valid ID │  │ Invalid  │  │ Missing  │  │ Effective│     │
│  │    12    │  │    0     │  │    0     │  │   12     │  │    0     │     │
│  │  100%    │  │   0%     │  │   0%     │  │  100%    │  │   0%     │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                                                                             │
│  ⚠️ ISSUE: 100% of RDR alerts have missing Order IDs                       │
│     ROOT CAUSE: Tokenized card data from Disputifier                        │
│     ACTION: Contact Disputifier for order_id pass-through                   │
│                                                                             │
│  CREDIT ELIGIBLE: 12 alerts × $11.00 = $132.00                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Ethoca Operations View
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ETHOCA OPERATIONS                                         Source: Altopay   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SLA STATUS (24h Window)                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │ 🔴 Breached: 367 (71%)  │ 🟡 At Risk: 23 (4%)  │ 🟢 Healthy: 123 │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  PIPELINE STATUS                                                            │
│  Received (413) → Matched (341) → Refund Init (287) → CRM (286) → Ack (413)│
│                         ↓              ↓                ↓                   │
│                   Invalid (72)    Pending (54)    Pending (1)              │
│                                                                             │
│  PROCESSING QUEUE (Requires Action)                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 54 alerts awaiting refund initiation (avg wait: 4.2h)               │   │
│  │ 1 alert awaiting CRM confirmation (avg wait: 2.1h)                  │   │
│  │ 0 alerts awaiting acknowledgment                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 CDRN Operations View
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CDRN OPERATIONS                                         Source: Disputifier │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SLA STATUS (72h Window)                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │ 🔴 Breached: 0 (0%)  │ 🟡 At Risk: 3 (5%)  │ 🟢 Healthy: 55 (95%)│     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                                                                             │
│  NOTE: CDRN is being deprecated by Visa. Monitor for phase-out timeline.   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Automated Alerts & Notifications

### Tier 1 - Critical (Immediate Action Required)
- SLA breach imminent (< 2 hours remaining)
- Data source offline for > 15 minutes
- Processing pipeline blocked (0 throughput)
- System errors or API failures

### Tier 2 - Warning (Review Within 1 Hour)
- SLA warning (< 50% time remaining)
- Alert volume anomaly (±30% from average)
- Processing delays detected (stage time > 2x average)

### Tier 3 - Info (Daily Review)
- Daily summary report
- Weekly trend analysis
- Credit eligibility report

---

## 5. Recommended Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OPERATIONS COMMAND CENTER                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    MODULE 1: SYSTEM HEALTH BANNER                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐   │
│  │                              │  │                                  │   │
│  │  MODULE 2: DATA INGESTION    │  │  MODULE 4: SLA COUNTDOWN         │   │
│  │  (Source Health)             │  │  (Risk Monitor)                  │   │
│  │                              │  │                                  │   │
│  └──────────────────────────────┘  └──────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │                  MODULE 3: PROCESSING PIPELINE                       │   │
│  │                  (Tabs: All | RDR | CDRN | Ethoca)                  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │                  MODULE 5: OPERATIONS METRICS & TRENDS              │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### Real-Time Queries Needed:
1. **Ingestion Monitor:** Count alerts by source in last 1h, 24h
2. **Pipeline Status:** Count alerts at each processing stage
3. **SLA Monitor:** Calculate time remaining for each alert
4. **Stuck Alerts:** Find alerts exceeding expected stage time
5. **Metrics:** MTTD, MTTR, SLA compliance rates

### Refresh Rates:
- System Health Banner: Every 30 seconds
- Data Ingestion: Every 1 minute
- Pipeline Status: Every 1 minute
- SLA Countdown: Every 1 minute
- Trends & Metrics: Every 5 minutes

---

## 7. Technical Implementation Notes

### API Endpoints Needed:
- `GET /api/ops/health` - System health status
- `GET /api/ops/ingestion` - Data source metrics
- `GET /api/ops/pipeline` - Processing pipeline status
- `GET /api/ops/sla` - SLA risk monitor
- `GET /api/ops/metrics` - Operations KPIs
- `GET /api/ops/alerts` - Actionable alerts list

### Frontend Components:
- Status indicator badges (green/yellow/red)
- Real-time counters with auto-refresh
- Pipeline visualization (Sankey or funnel diagram)
- Countdown timers for SLA
- Sparkline charts for trends
- Data tables with sorting/filtering

---

## 8. Priority Implementation Order

1. **Phase 1 (Critical):** SLA Countdown & Risk Monitor
   - This prevents credit loss immediately

2. **Phase 2 (High):** Processing Pipeline Status
   - Identifies bottlenecks in real-time

3. **Phase 3 (Medium):** Data Ingestion Monitor
   - Detects source issues early

4. **Phase 4 (Enhancement):** Operations Metrics
   - Long-term trend analysis

---

## References

- [SLA Monitoring Best Practices - Obkio](https://obkio.com/blog/sla-monitoring-and-reporting/)
- [SLA/SLO Monitoring Requirements 2025 - Uptrace](https://uptrace.dev/blog/sla-slo-monitoring-requirements)
- [Kount Dispute Management](https://support.kount.com/hc/en-us/articles/360051272932-Navigating-Dispute-and-Chargeback-Management)
- [Ethoca vs Verifi Comparison - Disputifier](https://www.disputifier.com/post/ethoca-vs-verifi-chargeback-alert-comparison)
- [Chargeback Prevention Tools - Rapyd](https://www.rapyd.net/blog/chargeback-prevention-tools/)
