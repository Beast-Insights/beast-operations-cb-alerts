# Operations Alerts Panel - Design Document v2
## Designed with Stripe-inspired principles using Tremor UI

---

## DESIGN PHILOSOPHY

Following Stripe's design principles:
1. **Clarity over decoration** - Every element serves a purpose
2. **Information density** - Pack data efficiently without clutter
3. **Subtle status indicators** - Muted colors, not screaming alerts
4. **Actionable first** - Clear next steps, not just information
5. **Progressive disclosure** - Show summary, expand for details

---

## COMPONENT ARCHITECTURE

### Location
**New route:** `/alerts` - Dedicated alerts page for historical view
**Embedded panel:** Top of `/workflow` (Ingestion) and `/processing` tabs

### Tremor Components Used
- `Card` - Container for sections
- `Badge` - Status indicators
- `Callout` - Alert messages
- `Table` - Historical alerts list
- `Button` - Actions
- `Divider` - Section separation
- `Tracker` - Visual timeline (for historical)
- `ProgressBar` - SLA countdown visualization

---

## SECTION 1: DATA SOURCE STATUS

### Design Rationale
Horizontal layout on desktop (3 columns) for quick scanning. This follows the Stripe dashboard pattern where KPIs are shown in a row. On mobile, stack vertically.

### Visual Design
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐ │
│  │ RDR                     │ │ ETHOCA                  │ │ CDRN                    │ │
│  │                         │ │                         │ │                         │ │
│  │ Last received           │ │ Last received           │ │ Last received           │ │
│  │ 2h 15m ago         ●    │ │ 45m ago            ●    │ │ 5h 30m ago         ●    │ │
│  │                         │ │                         │ │              [warning]  │ │
│  │ ─────────────────────── │ │ ─────────────────────── │ │ ─────────────────────── │ │
│  │ Ingested  18 Feb, 14:32 │ │ Ingested  18 Feb, 15:45 │ │ Ingested  18 Feb, 10:30 │ │
│  │ Occurred  18 Feb, 14:30 │ │ Occurred  18 Feb, 15:42 │ │ Occurred  18 Feb, 10:25 │ │
│  └─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘ │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Tremor Implementation
```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
  {['RDR', 'Ethoca', 'CDRN'].map((source) => (
    <Card key={source} className="p-4">
      <div className="flex items-center justify-between">
        <Text className="font-medium text-gray-900 dark:text-gray-50">
          {source}
        </Text>
        <Badge variant={getStatusVariant(source)}>
          {getStatusLabel(source)}
        </Badge>
      </div>

      <div className="mt-3">
        <Text className="text-gray-500 dark:text-gray-500">Last received</Text>
        <div className="flex items-center gap-2 mt-1">
          <Text className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
            {formatDuration(source.hoursAgo)}
          </Text>
          <div className={cx(
            "h-2 w-2 rounded-full",
            source.status === 'healthy' && "bg-emerald-500",
            source.status === 'warning' && "bg-amber-500",
            source.status === 'critical' && "bg-red-500",
          )} />
        </div>
      </div>

      <Divider className="my-3" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <Text className="text-gray-500">Ingested</Text>
          <Text className="text-gray-700 dark:text-gray-300">
            {formatDateTime(source.lastIngested)}
          </Text>
        </div>
        <div className="flex justify-between">
          <Text className="text-gray-500">Occurred</Text>
          <Text className="text-gray-700 dark:text-gray-300">
            {formatDateTime(source.alertTimestamp)}
          </Text>
        </div>
      </div>
    </Card>
  ))}
</div>
```

### Status Badge Variants
| Status | Duration | Badge Variant | Dot Color |
|--------|----------|---------------|-----------|
| Healthy | < 2 hours | `success` | `bg-emerald-500` |
| Warning | 2-5 hours | `warning` | `bg-amber-500` |
| Critical | > 5 hours | `error` | `bg-red-500` |

---

## SECTION 2: ACTIVE ALERTS

### Design Rationale
Use Tremor's `Callout` component for alerts - it's designed exactly for this purpose. Group by severity with collapsible sections. Show count badges in the header for quick scanning.

### Visual Design
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  Active alerts                                          [View all alerts →]           │
│                                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ● Critical                                                                  2  │  │
│  ├────────────────────────────────────────────────────────────────────────────────┤  │
│  │                                                                                │  │
│  │  ⚠ No CDRN alerts received in 6 hours                                         │  │
│  │    Last alert was ingested at 18 Feb, 10:30 IST                               │  │
│  │                                                        [Investigate →]         │  │
│  │                                                                                │  │
│  │  ⚠ 3 Ethoca alerts breaching SLA in <2 hours                                  │  │
│  │    Total amount at risk: ₹1,24,500                                            │  │
│  │                                                        [View alerts →]         │  │
│  │                                                                                │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ● Warning                                                                   4  │  │
│  ├────────────────────────────────────────────────────────────────────────────────┤  │
│  │                                                                                │  │
│  │  ! 5 Ethoca alerts pending acknowledgement >4 hours                           │  │
│  │    Oldest alert: 6h 45m ago                                         [View →]  │  │
│  │                                                                     [Dismiss] │  │
│  │                                                                                │  │
│  │  ! Avg refund processing time at 5.2h (target: 4h)                            │  │
│  │    8 alerts currently in refund queue                               [View →]  │  │
│  │                                                                     [Dismiss] │  │
│  │                                                                                │  │
│  │  ! Volume 35% below expected for last hour                                    │  │
│  │    Expected: ~45 alerts, Received: 29 alerts                    [Acknowledge] │  │
│  │                                                                                │  │
│  │  ! Order matching rate dropped to 72% for "ACME BILLING"                      │  │
│  │    7-day baseline: 89%                                          [Investigate] │  │
│  │                                                                                │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ○ Info                                                            [Expand ▼]  │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### All Clear State
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  Active alerts                                          [View all alerts →]           │
│                                                                                       │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                                │  │
│  │  ✓ All systems operational                                                    │  │
│  │    No alerts requiring attention                                              │  │
│  │                                                                                │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Tremor Implementation
```tsx
<Card>
  <div className="flex items-center justify-between">
    <Title>Active alerts</Title>
    <Button variant="light" asChild>
      <Link href="/alerts">View all alerts →</Link>
    </Button>
  </div>

  <div className="mt-4 space-y-4">
    {/* Critical Section */}
    <Disclosure defaultOpen>
      <DisclosureButton className="w-full">
        <div className="flex items-center justify-between px-4 py-3 bg-red-50 dark:bg-red-950 rounded-t-lg">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <Text className="font-medium">Critical</Text>
          </div>
          <Badge variant="error">{criticalCount}</Badge>
        </div>
      </DisclosureButton>
      <DisclosurePanel>
        <div className="border border-t-0 border-red-200 dark:border-red-900 rounded-b-lg p-4 space-y-3">
          {criticalAlerts.map((alert) => (
            <AlertItem key={alert.id} alert={alert} onDismiss={handleDismiss} />
          ))}
        </div>
      </DisclosurePanel>
    </Disclosure>

    {/* Warning Section */}
    <Disclosure defaultOpen>
      {/* Similar structure with amber colors */}
    </Disclosure>

    {/* Info Section - collapsed by default */}
    <Disclosure>
      {/* Similar structure with blue/gray colors */}
    </Disclosure>
  </div>
</Card>
```

### Alert Item Component
```tsx
function AlertItem({ alert, onDismiss }) {
  return (
    <div className="flex items-start justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
      <div className="flex-1">
        <Text className="font-medium text-gray-900 dark:text-gray-50">
          {alert.message}
        </Text>
        <Text className="text-sm text-gray-500 mt-1">
          {alert.details}
        </Text>
      </div>
      <div className="flex items-center gap-2 ml-4">
        {alert.actionUrl && (
          <Button variant="light" size="sm" asChild>
            <Link href={alert.actionUrl}>{alert.actionLabel}</Link>
          </Button>
        )}
        {alert.dismissible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDismiss(alert.id)}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  )
}
```

---

## SECTION 3: HISTORICAL ALERTS PAGE (`/alerts`)

### Purpose
Dedicated page to view all alerts (active + historical), with filtering and search capabilities.

### Visual Design
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                       │
│  Alerts                                                                               │
│  Monitor and manage system alerts                                                     │
│                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ [All] [Critical] [Warning] [Info] [Dismissed]          🔍 Search alerts...     │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                                 │ │
│  │  Today                                                                          │ │
│  │  ───────────────────────────────────────────────────────────────────────────── │ │
│  │                                                                                 │ │
│  │  16:45  ● No CDRN alerts received in 6 hours                          Active   │ │
│  │             Last ingested: 18 Feb, 10:30 IST                                   │ │
│  │                                                                                 │ │
│  │  15:30  ● 3 Ethoca alerts breaching SLA                               Active   │ │
│  │             Amount at risk: ₹1,24,500                                          │ │
│  │                                                                                 │ │
│  │  14:15  ○ Volume anomaly detected (-35%)                           Dismissed   │ │
│  │             Acknowledged by user at 14:20                                      │ │
│  │                                                                                 │ │
│  │  12:00  ○ Order matching rate drop for "ACME"                     Auto-resolved│ │
│  │             Rate recovered to 87% at 13:45                                     │ │
│  │                                                                                 │ │
│  │  Yesterday                                                                      │ │
│  │  ───────────────────────────────────────────────────────────────────────────── │ │
│  │                                                                                 │ │
│  │  23:15  ○ Ethoca acknowledgement delay                            Auto-resolved│ │
│  │             All pending alerts acknowledged                                    │ │
│  │                                                                                 │ │
│  │  ...                                                                            │ │
│  │                                                                                 │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                       │
│  ◀ Previous                                              Page 1 of 5    Next ▶      │
│                                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Alert States
| State | Description | Visual |
|-------|-------------|--------|
| Active | Currently requires attention | Solid dot, bold text |
| Dismissed | User acknowledged, no longer shown in panel | Hollow dot, muted text |
| Auto-resolved | System detected issue resolved | Hollow dot, strikethrough on issue |

### Data Model for Historical Alerts
```typescript
interface AlertRecord {
  id: string
  type: AlertType
  severity: 'critical' | 'warning' | 'info'
  message: string
  details: string
  createdAt: string           // When alert was triggered
  status: 'active' | 'dismissed' | 'auto_resolved'
  dismissedAt?: string        // When user dismissed
  dismissedBy?: string        // User who dismissed
  resolvedAt?: string         // When auto-resolved
  resolutionReason?: string   // Why it was resolved
}
```

### Storage
For MVP, store dismissed alerts in localStorage. Later, can move to database table `data.alert_history`.

---

## ALERT DEFINITIONS (FINAL)

### Alert 1: Data Source Offline
| Property | Value |
|----------|-------|
| ID | `data_source_offline` |
| Trigger | No alerts from source in 5 hours |
| Severity | CRITICAL |
| Message | "No {source} alerts received in {X} hours" |
| Details | "Last alert was ingested at {timestamp} IST" |
| Dismissible | No (auto-resolves when data resumes) |
| Action | "Investigate →" links to n8n workflow status |

### Alert 2: SLA Breach Countdown
| Property | Value |
|----------|-------|
| ID | `sla_breach_imminent` |
| Trigger | Alerts with <2 hours to SLA deadline |
| Severity | CRITICAL |
| Message | "{count} {type} alerts breaching SLA in <2 hours" |
| Details | "Total amount at risk: ₹{amount}" |
| Dismissible | No (auto-resolves when processed) |
| Action | "View alerts →" links to filtered alerts table |

### Alert 3: Ethoca Acknowledgement Delay
| Property | Value |
|----------|-------|
| ID | `ethoca_ack_delay` |
| Trigger | Ethoca alerts unacknowledged >4 hours from alert_timestamp |
| Severity | WARNING |
| Message | "{count} Ethoca alerts pending acknowledgement >4 hours" |
| Details | "Oldest alert: {duration} ago" |
| Dismissible | Yes |
| Action | "View →" links to filtered Ethoca alerts |

### Alert 4: Refund Processing Delay
| Property | Value |
|----------|-------|
| ID | `refund_processing_delay` |
| Trigger | Avg time from ingestion to refund_crm > 4 hours |
| Severity | WARNING |
| Message | "Avg refund processing time at {X}h (target: 4h)" |
| Details | "{count} alerts currently in refund queue" |
| Dismissible | Yes |
| Action | "View →" links to processing pipeline |

### Alert 5: Volume Anomaly
| Property | Value |
|----------|-------|
| ID | `volume_anomaly` |
| Trigger | Hourly volume ±30% from 4-week baseline |
| Severity | WARNING |
| Message | "Volume {X}% {above/below} expected for last hour" |
| Details | "Expected: ~{X} alerts, Received: {Y} alerts" |
| Dismissible | Yes (acknowledges user is aware) |
| Action | "Acknowledge" button |

### Alert 6: Order Matching Degradation
| Property | Value |
|----------|-------|
| ID | `order_matching_degradation` |
| Trigger | Matching rate drops >15% below 7-day baseline per descriptor |
| Severity | WARNING |
| Message | "Order matching rate dropped to {X}% for '{descriptor}'" |
| Details | "7-day baseline: {Y}%" |
| Dismissible | Yes |
| Action | "Investigate →" links to descriptor analysis |

### Alert 7: Overall Effectiveness Low
| Property | Value |
|----------|-------|
| ID | `overall_effectiveness_low` |
| Trigger | 7-day effectiveness <85% (info) or <75% (warning) |
| Severity | INFO or WARNING |
| Message | "Overall effectiveness at {X}% (target: 85%)" |
| Details | "{count} alerts turned to chargeback in last 7 days" |
| Dismissible | Yes |
| Action | "View report →" links to effectiveness analysis |

### Alert 8: Descriptor Effectiveness Drop
| Property | Value |
|----------|-------|
| ID | `descriptor_effectiveness_drop` |
| Trigger | Descriptor effectiveness drops >10% from 30-day baseline |
| Severity | INFO |
| Message | "Effectiveness for '{descriptor}' dropped to {X}%" |
| Details | "30-day baseline: {Y}%" |
| Dismissible | Yes |
| Action | "Investigate →" links to descriptor analysis |

---

## API DESIGN

### Endpoint: `GET /api/operations-alerts`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| timezone | string | IST | Display timezone |
| includeHistory | boolean | false | Include dismissed/resolved alerts |

**Response:**
```typescript
interface OperationsAlertsResponse {
  timestamp: string  // Server time in IST

  // Section 1: Data Source Status
  dataSourceStatus: {
    rdr: DataSourceStatus
    ethoca: DataSourceStatus
    cdrn: DataSourceStatus
  }

  // Section 2: Active Alerts
  alerts: {
    critical: Alert[]
    warning: Alert[]
    info: Alert[]
  }

  // Counts for badge display
  counts: {
    critical: number
    warning: number
    info: number
    total: number
  }
}

interface DataSourceStatus {
  source: 'RDR' | 'Ethoca' | 'CDRN'
  lastIngested: string | null      // created_at in IST
  alertTimestamp: string | null    // alert_timestamp in IST
  minutesAgo: number
  status: 'healthy' | 'warning' | 'critical'
}

interface Alert {
  id: string
  type: AlertType
  severity: 'critical' | 'warning' | 'info'
  message: string
  details: string
  createdAt: string
  dismissible: boolean
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, any>  // Additional data for specific alerts
}
```

### Endpoint: `POST /api/operations-alerts/dismiss`

**Request Body:**
```typescript
{
  alertId: string
}
```

**Response:**
```typescript
{
  success: boolean
  dismissedAt: string
}
```

---

## FILE STRUCTURE

```
components/ui/operations-alerts/
├── index.ts
├── OperationsAlertsPanel.tsx       # Main embedded panel
├── DataSourceStatusGrid.tsx        # Section 1
├── ActiveAlertsPanel.tsx           # Section 2
├── AlertItem.tsx                   # Individual alert row
├── AlertSeveritySection.tsx        # Collapsible severity group
├── types.ts                        # TypeScript interfaces
└── constants.ts                    # Thresholds, labels

app/alerts/
├── page.tsx                        # Historical alerts page
└── AlertsHistoryTable.tsx          # Full alerts table

lib/
└── alerts/
    ├── computeAlerts.ts            # Alert rule logic
    └── thresholds.ts               # Configurable thresholds

app/api/operations-alerts/
├── route.ts                        # GET endpoint
└── dismiss/
    └── route.ts                    # POST dismiss endpoint
```

---

## REFRESH BEHAVIOR

| Component | Refresh Interval | Trigger |
|-----------|------------------|---------|
| Data Source Status | 60 seconds | Auto + Manual |
| Active Alerts | 60 seconds | Auto + Manual |
| Historical Page | On page load | Manual only |

### Visual Feedback
- Show "Last updated: X seconds ago" timestamp
- Subtle pulse animation on refresh
- Loading skeleton during fetch

---

## MOBILE CONSIDERATIONS

- Data Source Status: Stack cards vertically
- Active Alerts: Full width, same layout
- Collapse Info section by default on mobile
- Touch-friendly dismiss buttons (min 44px tap target)

---

## READY FOR IMPLEMENTATION

This design is ready for implementation. The key decisions:

1. **Horizontal layout** for Data Source Status on desktop (Stripe pattern)
2. **Dismissible alerts** with localStorage persistence (MVP)
3. **Dedicated `/alerts` page** for historical view
4. **IST timezone** as default
5. **Tremor components** throughout (Card, Badge, Button, Callout patterns)
6. **Auto-refresh every 60 seconds**

Awaiting your go-ahead to proceed with implementation.
