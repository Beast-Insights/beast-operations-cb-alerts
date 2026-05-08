'use client'

import { Card } from '@/components/Card'
import { AreaChart, type TooltipProps as AreaTooltipProps } from '@/components/AreaChart'
import { LineChart, type TooltipProps as LineTooltipProps } from '@/components/LineChart'
import { BarList } from '@/components/BarList'
import { ProgressBar } from '@/components/ProgressBar'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/Tabs'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRoot } from '@/components/Table'
import { Badge } from '@/components/Badge'
import { DateRangePicker, type DateRange } from '@/components/DatePicker'
import { TimezoneToggle, useTimezone, type Timezone } from '@/components/TimezoneToggle'
import { Tracker, type TrackerBlockProps } from '@/components/Tracker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/Drawer'
import {
  RiSunLine,
  RiMoonLine,
  RiRefreshLine,
  RiLoader4Line,
  RiArrowUpSFill,
  RiArrowDownSFill,
  RiCheckboxCircleFill,
  RiTimeLine,
  RiCheckLine,
  RiCloseLine,
  RiAlertLine,
  RiQuestionLine
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useEffect, useState, useCallback } from 'react'
import { getColorClassName, type AvailableChartColorsKeys } from '@/lib/chartColors'
import { cx, formatDateLocal } from '@/lib/utils'
import { NotificationsPanel } from '@/components/ui/operations-alerts'

// Custom tooltip for Alert Volume Trends with Total - Following Tremor's exact pattern
const AlertVolumeTrendsTooltip = ({ payload, active, label }: AreaTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null

  // Filter out duplicate categories (keep first occurrence)
  const uniquePayload = payload.filter((item, index, self) =>
    index === self.findIndex(t => t.category === item.category)
  )

  const total = uniquePayload.reduce((sum, item) => sum + (item.value || 0), 0)

  return (
    <div className="rounded-md border text-sm shadow-md border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <div className="border-b border-inherit px-4 py-2">
        <p className="font-medium text-gray-900 dark:text-gray-50">{label}</p>
      </div>
      <div className="space-y-1 px-4 py-2">
        {uniquePayload.map(({ value, category, color }, index) => (
          <div key={`id-${index}`} className="flex items-center justify-between space-x-8">
            <div className="flex items-center space-x-2">
              <span
                aria-hidden="true"
                className={`h-[3px] w-3.5 shrink-0 rounded-full ${getColorClassName(color as AvailableChartColorsKeys, 'bg')}`}
              />
              <p className="text-right whitespace-nowrap text-gray-700 dark:text-gray-300">
                {category}
              </p>
            </div>
            <p className="text-right font-medium whitespace-nowrap tabular-nums text-gray-900 dark:text-gray-50">
              {value?.toLocaleString() || 0}
            </p>
          </div>
        ))}
        <div className="flex items-center justify-between space-x-8 border-t border-gray-200 dark:border-gray-800 pt-2 mt-1">
          <p className="font-medium text-gray-900 dark:text-gray-50">Total</p>
          <p className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
            {total.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}

// Factory function for Today vs Yesterday tooltip - accepts timezone parameter
const createTodayVsYesterdayTooltip = (tz: Timezone) => {
  return ({ payload, active, label }: LineTooltipProps) => {
    if (!active || !payload || payload.length === 0) return null

    // Filter out duplicate categories (keep first occurrence)
    const uniquePayload = payload.filter((item, index, self) =>
      index === self.findIndex(t => t.category === item.category)
    )

    return (
      <div className="rounded-md border text-sm shadow-md border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="border-b border-inherit px-4 py-2">
          <p className="font-medium text-gray-900 dark:text-gray-50">{label} {tz}</p>
        </div>
        <div className="space-y-1 px-4 py-2">
          {uniquePayload.map(({ value, category, color }, index) => (
            <div key={`id-${index}`} className="flex items-center justify-between space-x-8">
              <div className="flex items-center space-x-2">
                <span
                  aria-hidden="true"
                  className={`h-[3px] w-3.5 shrink-0 rounded-full ${getColorClassName(color as AvailableChartColorsKeys, 'bg')}`}
                />
                <p className="text-right whitespace-nowrap text-gray-700 dark:text-gray-300">
                  {category}
                </p>
              </div>
              <p className="text-right font-medium whitespace-nowrap tabular-nums text-gray-900 dark:text-gray-50">
                {value !== null && value !== undefined ? value.toLocaleString() : '-'}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }
}

// Types
interface DataIngestion {
  source: string
  lastIngestedAt: string
  minutesAgo: number | null
}

interface VolumeStat {
  count: number
  prevCount: number
  change: number
}

interface VolumeSummary {
  ethoca: VolumeStat
  cdrn: VolumeStat
  rdr: VolumeStat
}

interface VolumeTrend {
  time: string
  Ethoca: number
  CDRN: number
  RDR: number
}

interface AlertCompositionDay {
  date: string
  ethoca: number
  cdrn: number
  rdr: number
  ethocaEffective: number
  cdrnEffective: number
  rdrEffective: number
}

interface ProcessingTime {
  cdrnAvgTimeToCrmRefund: number | null
  ethocaAvgTimeToCrmRefund: number | null
  ethocaAvgTimeToAcknowledge: number | null
  cdrnRefundCount: number
  ethocaRefundCount: number
  ethocaAcknowledgedCount: number
}

interface RDRFlow {
  received: number
  validOrderId: number
  invalidOrderId: number
  missingOrderId: number
  validAlreadyRefunded: number
  validNotRefunded: number
  validBlacklisted: number
  validNotBlacklisted: number
  refundInitiated: number
  refundCrm: number
  effective: number
  turnedToCB: number
  creditEligible: number
  creditEligibleAmount: number
  effectivenessRate: number
}

interface CDRNFlow {
  received: number
  orderMatched: number
  orderNotMatched: number
  matchedAlreadyRefunded: number
  matchedRefundInitiated: number
  matchedRefundConfirmed: number
  blacklisted: number
  effective: number
  turnedToCB: number
  creditEligible: number
  creditEligibleAmount: number
  effectivenessRate: number
}

interface EthocaFlow {
  received: number
  orderMatched: number
  orderNotMatched: number
  matchedAlreadyRefunded: number
  matchedRefundInitiated: number
  matchedRefundConfirmed: number
  acknowledged: number
  closed: number
  blacklisted: number
  effective: number
  turnedToCB: number
  creditEligible: number
  creditEligibleAmount: number
  effectivenessRate: number
}

interface AlertNeedingAttention {
  alertId: string
  alertType: string
  alertTime: string
  ageHours: number
  descriptor: string
  amount: number
  issueType: string
  flags: {
    orderMatched: boolean
    refundInitiated: boolean
    refundConfirmed: boolean
    acknowledged: boolean
    closed: boolean
  }
}

interface IngestionBucket {
  timeBucket: string
  count: number
}

interface VolumeBySource {
  ethoca: number
  cdrn: number
  rdr: number
}

interface TodayVsYesterdayData {
  hour: number
  time: string
  Today: number | null
  Yesterday: number
}

interface IngestionDelay {
  avg24h: number | null
  min24h: number | null
  max24h: number | null
  avg7d: number | null
  avg30d: number | null
}

interface OpsData {
  dateRange: { start: string; end: string }
  prevDateRange: { start: string; end: string }
  timeBasis: 'ingestion' | 'alert'
  dataIngestion: DataIngestion[]
  volumeSummary: VolumeSummary
  volumeTrends: VolumeTrend[]
  volumeTrends24h: VolumeTrend[]
  volumeTrends30d: VolumeTrend[]
  processingTime: ProcessingTime
  rdrFlow: RDRFlow
  cdrnFlow: CDRNFlow
  ethocaFlow: EthocaFlow
  alertsNeedingAttention: AlertNeedingAttention[]
  hourlyIngestion: IngestionBucket[]
  dailyIngestion: IngestionBucket[]
  latestIngestionTimestamp: string | null
  volumeByPeriod: {
    '24h': VolumeBySource
    '7d': VolumeBySource
    '30d': VolumeBySource
  }
  ingestionDelay: IngestionDelay
  todayVsYesterday: TodayVsYesterdayData[]
  todayTotal: number
  yesterdayTotal: number
  n8nHourly: N8nLogBucket[]
  n8nDaily: N8nLogBucket[]
  summary: { totalAlerts: number; totalPrevAlerts: number }
}

// n8n Workflow Log bucket
interface N8nLogBucket {
  timeBucket: string
  total: number
  success: number
  failed: number
}

// Alert data from alerts_raw table
interface Alert {
  id: number
  alertId: string
  alertType: string
  alertCategory: string | null
  alertTimestamp: string | null
  createdAt: string
  alertAgeHours: number | null
  merchantDescriptor: string | null
  merchantMemberName: string | null
  memberId: string | null
  mcc: string | null
  gatewayName: string | null
  transactionAmount: number
  transactionCurrency: string | null
  transactionId: string | null
  transactionTimestamp: string | null
  transactionType: string | null
  arn: string | null
  authCode: string | null
  cardBin: string | null
  cardLastFour: string | null
  cardNumberMasked: string | null
  cardType: string | null
  orderId: string | null
  orderIdSource: string | null
  isOrderIdValid: boolean | null
  crm: string | null
  isAlreadyRefunded: boolean | null
  isRefundInit: boolean | null
  refundTimestampInit: string | null
  isRefundCrm: boolean | null
  refundTimestampCrm: string | null
  isAcknowledged: boolean | null
  acknowledgementStatus: string | null
  acknowledgementTimestamp: string | null
  acknowledgementRefundStatus: string | null
  isClosed: boolean | null
  isBlacklisted: boolean | null
  isFraud: boolean | null
  postAlertStatus: string | null
  status: string | null
  platform: string | null
  source: string | null
  issuer: string | null
  is3dSecure: boolean | null
  caseType: string | null
  caseAmount: number | null
  reasonCode: string | null
  reasonCodeDescription: string | null
  alertProvider: string | null
  alertProcessor: string | null
  alertCost: number
  alertPrice: number
  dataSource: string | null
}

interface AlertsResponse {
  alerts: Alert[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export default function OperationsDashboard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<OpsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [userChangedDate, setUserChangedDate] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [trendView, setTrendView] = useState<'24h' | '7d' | '30d'>('7d')
  const [ingestionView, setIngestionView] = useState<'24h' | '30d'>('24h')
  const [timeBasis, setTimeBasis] = useState<'ingestion' | 'alert'>('ingestion')
  const [timezone, setTimezone, timezoneLoaded] = useTimezone()

  // Alerts table state
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [alertsLoading, setAlertsLoading] = useState(false)
  const [alertsPagination, setAlertsPagination] = useState({ total: 0, limit: 50, offset: 0, hasMore: false })
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')
  const [compositionData, setCompositionData] = useState<AlertCompositionDay[]>([])
  const [compositionView, setCompositionView] = useState<'day' | 'week' | 'month'>('day')

  useEffect(() => {
    setMounted(true)
  }, [])

  const fetchData = useCallback(async (range?: DateRange, basis?: 'ingestion' | 'alert', tz?: Timezone) => {
    try {
      setLoading(true)
      const tzParam = tz || timezone
      const params = new URLSearchParams()
      params.set('timezone', tzParam)
      if (range?.from && range?.to) {
        params.set('startDate', formatDateLocal(range.from))
        params.set('endDate', formatDateLocal(range.to))
      }
      params.set('timeBasis', basis || timeBasis)
      const url = `/api/workflow?${params.toString()}`
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
      setLastUpdated(new Date())
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      return null
    } finally {
      setLoading(false)
    }
  }, [timeBasis, timezone])

  // Fetch alerts for the table
  const fetchAlerts = useCallback(async (range?: DateRange, alertType?: string, outcome?: string, offset = 0) => {
    try {
      setAlertsLoading(true)
      const params = new URLSearchParams()
      if (range?.from && range?.to) {
        params.set('startDate', formatDateLocal(range.from))
        params.set('endDate', formatDateLocal(range.to))
      }
      if (alertType && alertType !== 'all') {
        params.set('alertType', alertType)
      }
      if (outcome && outcome !== 'all') {
        params.set('outcomeStatus', outcome)
      }
      params.set('limit', '50')
      params.set('offset', offset.toString())

      const response = await fetch(`/api/alerts?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to fetch alerts')
      const result: AlertsResponse = await response.json()
      setAlerts(result.alerts)
      setAlertsPagination(result.pagination)
    } catch (err) {
      console.error('Error fetching alerts:', err)
    } finally {
      setAlertsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Wait for timezone to be loaded from localStorage before fetching
    if (!timezoneLoaded) return

    fetchData(undefined, 'ingestion', timezone).then((result) => {
      if (result?.dateRange) {
        setDateRange({
          from: new Date(result.dateRange.start),
          to: new Date(result.dateRange.end)
        })
      }
    })

    // Fetch alert composition data (all dates, independent of date range)
    fetch('/api/alert-composition')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCompositionData(data)
      })
      .catch(err => console.error('Failed to fetch composition data:', err))
  }, [timezoneLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDateRangeChange = (newRange: DateRange | undefined) => {
    setDateRange(newRange)
    setUserChangedDate(true)
  }

  useEffect(() => {
    if (userChangedDate && dateRange?.from && dateRange?.to) {
      fetchData(dateRange, timeBasis, timezone)
      setUserChangedDate(false)
    }
  }, [userChangedDate, dateRange, fetchData, timeBasis, timezone])

  // Re-fetch when timeBasis changes
  const handleTimeBasisChange = (newBasis: 'ingestion' | 'alert') => {
    setTimeBasis(newBasis)
    fetchData(dateRange, newBasis, timezone)
  }

  // Handle timezone change
  const handleTimezoneChange = (newTimezone: Timezone) => {
    setTimezone(newTimezone)
    fetchData(dateRange, timeBasis, newTimezone)
  }

  // Fetch alerts when date range or filters change
  useEffect(() => {
    if (dateRange?.from && dateRange?.to) {
      fetchAlerts(dateRange, alertTypeFilter, outcomeFilter)
    }
  }, [dateRange, alertTypeFilter, outcomeFilter, fetchAlerts])

  // Handle alert row click
  const handleAlertClick = (alert: Alert) => {
    setSelectedAlert(alert)
    setDrawerOpen(true)
  }

  // Handle pagination
  const handleNextPage = () => {
    if (alertsPagination.hasMore) {
      fetchAlerts(dateRange, alertTypeFilter, outcomeFilter, alertsPagination.offset + alertsPagination.limit)
    }
  }

  const handlePrevPage = () => {
    if (alertsPagination.offset > 0) {
      fetchAlerts(dateRange, alertTypeFilter, outcomeFilter, Math.max(0, alertsPagination.offset - alertsPagination.limit))
    }
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  // Helper function to format time ago
  const formatTimeAgo = (minutes: number | null) => {
    if (minutes === null) return 'Unknown'
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  // Helper function to get ingestion status color
  const getIngestionStatus = (minutes: number | null) => {
    if (minutes === null) return { color: 'gray', label: 'Unknown' }
    if (minutes <= 15) return { color: 'emerald', label: 'Healthy' }
    if (minutes <= 60) return { color: 'yellow', label: 'Delayed' }
    return { color: 'red', label: 'Stale' }
  }

  // Helper to format hours
  const formatHours = (hours: number | null) => {
    if (hours === null) return 'N/A'
    if (hours < 1) return `${Math.round(hours * 60)} min`
    return `${hours.toFixed(1)} hrs`
  }

  // Helper to format alert type - simplified to just Ethoca, CDRN, RDR
  const formatAlertType = (type: string) => {
    switch (type) {
      case 'issuer_alert':
      case 'customerdispute_alert':
        return 'Ethoca'
      case 'CDRN': return 'CDRN'
      case 'RDR': return 'RDR'
      default: return type
    }
  }

  // Helper to get alert type badge color - intuitive colors
  const getAlertTypeBadgeColor = (type: string): 'blue' | 'purple' | 'emerald' | 'gray' => {
    switch (type) {
      case 'issuer_alert':
      case 'customerdispute_alert':
        return 'blue'      // Ethoca = Blue
      case 'CDRN':
        return 'purple'    // CDRN = Purple
      case 'RDR':
        return 'emerald'   // RDR = Green
      default:
        return 'gray'
    }
  }

  // Helper to get refund status badge
  const getRefundBadge = (alert: Alert) => {
    if (alert.isRefundCrm) {
      return { label: 'Refunded', color: 'emerald' as const }
    }
    if (alert.isRefundInit) {
      return { label: 'Initiated', color: 'cyan' as const }
    }
    if (alert.isAlreadyRefunded) {
      return { label: 'Pre-Refunded', color: 'blue' as const }
    }
    return { label: 'No Refund', color: 'gray' as const }
  }

  // Helper to get outcome badge - colorful Tremor-style pills with intuitive colors
  const getOutcomeBadge = (alert: Alert) => {
    if (alert.postAlertStatus === 'effective') {
      return { label: 'Effective', color: 'emerald' as const }      // Green = Success!
    }
    if (alert.postAlertStatus === 'alert_got_chargeback') {
      return { label: 'Chargeback', color: 'red' as const }         // Red = Failed/Bad
    }
    if (alert.postAlertStatus === 'invalid_order') {
      return { label: 'Invalid Order', color: 'orange' as const }   // Orange = Issue
    }
    if (alert.postAlertStatus === 'unable_to_refund') {
      return { label: 'Unable to Refund', color: 'rose' as const }  // Rose = Problem
    }
    if (alert.postAlertStatus === 'alert_already_refunded') {
      return { label: 'Already Refunded', color: 'sky' as const }   // Sky = Pre-existing
    }
    if (alert.isRefundCrm) {
      return { label: 'Refunded', color: 'emerald' as const }       // Green = Done
    }
    if (alert.isRefundInit) {
      return { label: 'Refund Initiated', color: 'cyan' as const }  // Cyan = In Progress
    }
    if (alert.isAcknowledged) {
      return { label: 'Acknowledged', color: 'indigo' as const }    // Indigo = Processing
    }
    return { label: 'Pending', color: 'gray' as const }             // Gray = Waiting
  }

  // Helper to format date/time in user's selected timezone
  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone === 'IST' ? 'Asia/Kolkata' : 'America/New_York'
    })
  }

  // Helper to format currency
  const formatCurrency = (amount: number, currency?: string | null) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2
    }).format(amount)
  }

  // Helper to render boolean status icon
  const renderBooleanIcon = (value: boolean | null) => {
    if (value === true) return <RiCheckLine className="size-4 text-emerald-500" />
    if (value === false) return <RiCloseLine className="size-4 text-gray-400" />
    return <RiQuestionLine className="size-4 text-gray-300" />
  }

  // Generate n8n workflow tracker data from real data - Success/Fail only
  // Note: Backend returns hour buckets in the user's selected timezone (as wall-clock hours)
  const generateHourlyTrackerData = (): TrackerBlockProps[] => {
    if (!data?.n8nHourly || data.n8nHourly.length === 0) {
      // Return empty placeholder if no data
      return Array.from({ length: 24 }, (_, i) => ({
        key: `hour-${i}`,
        color: 'bg-gray-300 dark:bg-gray-700',
        tooltip: 'No data'
      }))
    }

    return data.n8nHourly.map((bucket, i) => {
      const date = new Date(bucket.timeBucket)
      // Use timeZone: 'UTC' to extract raw hour value (backend already adjusted for display timezone)
      const hourStr = date.toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' })

      // Determine status: failed if any failures, success if any runs with no failures, gray if no runs
      let status: 'success' | 'fail' | 'none' = 'none'
      if (bucket.total > 0) {
        status = bucket.failed > 0 ? 'fail' : 'success'
      }

      const tooltip = bucket.total > 0
        ? `${hourStr} ${timezone}: ${bucket.success} success, ${bucket.failed} failed`
        : `${hourStr} ${timezone}: No runs`

      return {
        key: `hour-${i}`,
        color: status === 'success' ? 'bg-emerald-500' : status === 'fail' ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-700',
        tooltip
      }
    })
  }

  const generateDailyTrackerData = (): TrackerBlockProps[] => {
    if (!data?.n8nDaily || data.n8nDaily.length === 0) {
      // Return empty placeholder if no data
      return Array.from({ length: 30 }, (_, i) => ({
        key: `day-${i}`,
        color: 'bg-gray-300 dark:bg-gray-700',
        tooltip: 'No data'
      }))
    }

    return data.n8nDaily.map((bucket, i) => {
      const date = new Date(bucket.timeBucket)
      const dayStr = date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })

      // Determine status: failed if any failures, success if any runs with no failures, gray if no runs
      let status: 'success' | 'fail' | 'none' = 'none'
      if (bucket.total > 0) {
        status = bucket.failed > 0 ? 'fail' : 'success'
      }

      const tooltip = bucket.total > 0
        ? `${dayStr}: ${bucket.success} success, ${bucket.failed} failed`
        : `${dayStr}: No runs`

      return {
        key: `day-${i}`,
        color: status === 'success' ? 'bg-emerald-500' : status === 'fail' ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-700',
        tooltip
      }
    })
  }

  const hourlyTrackerData = generateHourlyTrackerData()
  const dailyTrackerData = generateDailyTrackerData()

  // Calculate success rate from tracker data
  const calculateSuccessRate = (trackerData: TrackerBlockProps[]) => {
    const success = trackerData.filter(d => d.color === 'bg-emerald-500').length
    return ((success / trackerData.length) * 100).toFixed(1)
  }

  // Generate incoming alerts tracker data from real data
  // Note: Backend returns hour buckets in the user's selected timezone (as wall-clock hours)
  const generateAlertHourlyTrackerData = (ingestionData: IngestionBucket[]): TrackerBlockProps[] => {
    if (!ingestionData || ingestionData.length === 0) {
      return Array.from({ length: 24 }, (_, i) => ({
        key: `hour-${i}`,
        color: 'bg-gray-300 dark:bg-gray-700',
        tooltip: 'No data'
      }))
    }

    const counts = ingestionData.map(d => d.count)
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length

    return ingestionData.map((bucket, i) => {
      const date = new Date(bucket.timeBucket)
      // Use timeZone: 'UTC' to extract raw hour value (backend already adjusted for display timezone)
      const hourStr = date.toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' })

      // Color based on volume intensity
      let color: string
      if (bucket.count === 0) {
        color = 'bg-gray-300 dark:bg-gray-700'
      } else if (bucket.count >= avgCount * 1.5) {
        color = 'bg-blue-600' // High volume
      } else if (bucket.count >= avgCount * 0.5) {
        color = 'bg-blue-400' // Normal volume
      } else {
        color = 'bg-blue-200' // Low volume
      }

      return {
        key: `alert-hour-${i}`,
        color,
        tooltip: `${hourStr} ${timezone}: ${bucket.count} alerts`
      }
    })
  }

  const generateAlertDailyTrackerData = (ingestionData: IngestionBucket[]): TrackerBlockProps[] => {
    if (!ingestionData || ingestionData.length === 0) {
      return Array.from({ length: 30 }, (_, i) => ({
        key: `day-${i}`,
        color: 'bg-gray-300 dark:bg-gray-700',
        tooltip: 'No data'
      }))
    }

    const counts = ingestionData.map(d => d.count)
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length

    return ingestionData.map((bucket, i) => {
      const date = new Date(bucket.timeBucket)
      const dayStr = date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })

      // Color based on volume intensity
      let color: string
      if (bucket.count === 0) {
        color = 'bg-gray-300 dark:bg-gray-700'
      } else if (bucket.count >= avgCount * 1.5) {
        color = 'bg-blue-600' // High volume
      } else if (bucket.count >= avgCount * 0.5) {
        color = 'bg-blue-400' // Normal volume
      } else {
        color = 'bg-blue-200' // Low volume
      }

      return {
        key: `alert-day-${i}`,
        color,
        tooltip: `${dayStr}: ${bucket.count} alerts`
      }
    })
  }

  // Calculate total alerts from tracker data
  const calculateTotalAlerts = (ingestionData: IngestionBucket[]) => {
    if (!ingestionData || ingestionData.length === 0) return 0
    return ingestionData.reduce((sum, d) => sum + d.count, 0)
  }

  const alertHourlyTrackerData = generateAlertHourlyTrackerData(data?.hourlyIngestion || [])
  const alertDailyTrackerData = generateAlertDailyTrackerData(data?.dailyIngestion || [])

  // Aggregate volume trends by time period
  // Uses dedicated data sources for each view to ensure consistency with trackers
  const aggregateTrends = (
    trends24h: VolumeTrend[] | undefined,
    trends30d: VolumeTrend[] | undefined,
    view: '24h' | '7d' | '30d'
  ) => {
    // For 24h view, use the dedicated 24h data (hourly, same as hourlyIngestion)
    if (view === '24h') {
      if (!trends24h || trends24h.length === 0) return []
      return trends24h.map(t => ({
        ...t,
        // Use timeZone: 'UTC' to extract raw hour value (backend already adjusted for display timezone)
        time: new Date(t.time).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' })
      }))
    }

    // For 30d view, use the dedicated 30d data (daily, same as dailyIngestion)
    if (view === '30d') {
      if (!trends30d || trends30d.length === 0) return []
      return trends30d.map(t => ({
        ...t,
        time: new Date(t.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }))
    }

    // For 7d view, filter the 30d data to last 7 days
    if (!trends30d || trends30d.length === 0) return []

    // Get the last 7 entries (days) from the 30d data
    const last7Days = trends30d.slice(-7)
    return last7Days.map(t => ({
      ...t,
      time: new Date(t.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }))
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <div className="flex items-center gap-3 text-gray-500">
          <RiLoader4Line className="size-6 animate-spin" />
          <span>Loading operations data...</span>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <div className="text-center text-red-500">
          <p>Failed to load operations data</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  const trendData = aggregateTrends(data.volumeTrends24h, data.volumeTrends30d, trendView)

  return (
    <div>
      {/* Navigation */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 pt-3">
          <div className="flex items-center gap-2">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#3B82F6" strokeWidth="2" fill="none"/>
              <circle cx="12" cy="12" r="5" stroke="#3B82F6" strokeWidth="2" fill="none"/>
              <circle cx="12" cy="12" r="1.5" fill="#3B82F6"/>
            </svg>
            <span className="text-base font-semibold text-gray-900 dark:text-gray-50">Operations Dashboard</span>
          </div>
          <div className="flex h-[42px] flex-nowrap items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <TimezoneToggle value={timezone} onChange={handleTimezoneChange} />
            <div className="w-64">
              <DateRangePicker
                value={dateRange}
                onChange={handleDateRangeChange}
                placeholder="Select date range"
              />
            </div>
            <button
              onClick={() => fetchData(dateRange, timeBasis, timezone)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-2 text-center text-sm font-medium text-gray-700 shadow-sm transition-all duration-100 ease-in-out hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              <RiRefreshLine className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={toggleTheme}
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400"
              aria-label="Toggle theme"
            >
              {mounted && (theme === 'dark' ? <RiSunLine className="size-5" /> : <RiMoonLine className="size-5" />)}
            </button>
            <NotificationsPanel />
          </div>
        </div>
        <TabNavigation className="mt-5">
          <div className="mx-auto flex w-full max-w-7xl items-center px-6">
            <TabNavigationLink href="/workflow" active={true}>Ingestion</TabNavigationLink>
            <TabNavigationLink href="/processing">Processing</TabNavigationLink>
          </div>
        </TabNavigation>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <main>
          {/* Section 1: Data Ingestion & Volume Trends */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left Column: Combined Trackers - Following Tremor tracker-04 pattern */}
            <Card>
              {/* Section Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium text-gray-900 dark:text-gray-50">
                    Data Ingestion
                  </h3>
                  <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs text-gray-700 ring-1 ring-inset ring-gray-200 dark:text-gray-300 dark:ring-gray-800">
                    <span
                      className={`-ml-0.5 size-1.5 rounded-full ${
                        parseFloat(calculateSuccessRate(hourlyTrackerData)) >= 95 ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      aria-hidden={true}
                    />
                    {parseFloat(calculateSuccessRate(hourlyTrackerData)) >= 95 ? 'Healthy' : 'Degraded'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Tabs value={timeBasis} onValueChange={(v) => handleTimeBasisChange(v as 'ingestion' | 'alert')}>
                    <TabsList variant="solid">
                      <TabsTrigger value="ingestion" className="text-xs px-2 py-0.5">Ingested</TabsTrigger>
                      <TabsTrigger value="alert" className="text-xs px-2 py-0.5">Occurred</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Tabs value={ingestionView} onValueChange={(v) => setIngestionView(v as '24h' | '30d')}>
                    <TabsList variant="solid">
                      <TabsTrigger value="24h" className="text-xs px-2 py-0.5">24h</TabsTrigger>
                      <TabsTrigger value="30d" className="text-xs px-2 py-0.5">30d</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {/* n8n Workflow Status */}
              <div className="mt-8 flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <RiCheckboxCircleFill
                    className={`size-5 shrink-0 ${parseFloat(calculateSuccessRate(ingestionView === '24h' ? hourlyTrackerData : dailyTrackerData)) >= 95 ? 'text-emerald-500' : 'text-amber-500'}`}
                    aria-hidden={true}
                  />
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-50">n8n Workflow Status</p>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
                  {calculateSuccessRate(ingestionView === '24h' ? hourlyTrackerData : dailyTrackerData)}% success
                </p>
              </div>
              <Tracker data={ingestionView === '24h' ? hourlyTrackerData : dailyTrackerData} className="mt-4 w-full" hoverEffect />
              <div className="mt-3 flex items-center justify-between text-sm text-gray-500 dark:text-gray-500">
                <span>{ingestionView === '24h' ? '24h ago' : '30d ago'}</span>
                <span>Now ({timezone})</span>
              </div>

              {/* Divider */}
              <div className="mt-6 h-px w-full bg-gray-200 dark:bg-gray-800" aria-hidden={true} />

              {/* Incoming Alerts */}
              <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <RiCheckboxCircleFill
                    className="size-5 shrink-0 text-blue-500"
                    aria-hidden={true}
                  />
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-50">Incoming Alerts</p>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
                  {calculateTotalAlerts(ingestionView === '24h' ? data.hourlyIngestion : data.dailyIngestion).toLocaleString()} alerts
                </p>
              </div>
              <Tracker data={ingestionView === '24h' ? alertHourlyTrackerData : alertDailyTrackerData} className="mt-4 w-full" hoverEffect />
              <div className="mt-3 flex items-center justify-between text-sm text-gray-500 dark:text-gray-500">
                <span>{ingestionView === '24h' ? '24h ago' : '30d ago'}</span>
                <span>Now ({timezone})</span>
              </div>

              {/* Legend */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-x-2 rounded-md bg-gray-100 px-2 py-0.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Success
                </span>
                <span className="inline-flex items-center gap-x-2 rounded-md bg-gray-100 px-2 py-0.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span className="size-2 rounded-full bg-red-500" />
                  Fail
                </span>
                <span className="inline-flex items-center gap-x-2 rounded-md bg-gray-100 px-2 py-0.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span className="size-2 rounded-full bg-blue-600" />
                  High Volume
                </span>
                <span className="inline-flex items-center gap-x-2 rounded-md bg-gray-100 px-2 py-0.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span className="size-2 rounded-full bg-blue-400" />
                  Normal
                </span>
                <span className="inline-flex items-center gap-x-2 rounded-md bg-gray-100 px-2 py-0.5 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span className="size-2 rounded-full bg-blue-200" />
                  Low
                </span>
              </div>

              {/* Ingestion Summary - Strategic metrics for ops monitoring */}
              <h4 className="mt-6 text-sm text-gray-900 dark:text-gray-50">
                Ingestion Summary
              </h4>
              <ul
                role="list"
                className="mt-2 w-full divide-y divide-gray-200 text-sm text-gray-600 dark:divide-gray-800 dark:text-gray-500"
              >
                {/* Last Ingested - Exact timestamp (already converted to selected timezone by backend) */}
                <li className="flex w-full items-center justify-between py-2">
                  <span>Last Ingested</span>
                  <span className="font-medium text-gray-900 dark:text-gray-50">
                    {data.latestIngestionTimestamp
                      ? new Date(data.latestIngestionTimestamp).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                          timeZone: 'UTC' // Backend already applies timezone conversion
                        }) + ` ${timezone}`
                      : 'Unknown'}
                  </span>
                </li>
                {/* Avg Ingestion Delay - Time between alert_timestamp and created_at */}
                <li className="flex w-full items-center justify-between py-2">
                  <span>Avg Ingestion Delay ({ingestionView})</span>
                  <span className="font-medium text-gray-900 dark:text-gray-50">
                    {(() => {
                      const delay = ingestionView === '24h'
                        ? data.ingestionDelay?.avg24h
                        : data.ingestionDelay?.avg30d
                      if (delay === null || delay === undefined) return 'N/A'
                      if (delay < 1) return `${Math.round(delay * 60)} sec`
                      if (delay < 60) return `${Math.round(delay)} min`
                      return `${(delay / 60).toFixed(1)} hrs`
                    })()}
                  </span>
                </li>
                {/* Today vs Yesterday - Anomaly detection */}
                <li className="flex w-full items-center justify-between py-2">
                  <span>Today vs Yesterday</span>
                  <span className="font-medium">
                    {(() => {
                      if (!data.dailyIngestion || data.dailyIngestion.length < 2) return <span className="text-gray-900 dark:text-gray-50">N/A</span>
                      const today = data.dailyIngestion[data.dailyIngestion.length - 1]?.count || 0
                      const yesterday = data.dailyIngestion[data.dailyIngestion.length - 2]?.count || 0
                      if (yesterday === 0) return <span className="text-gray-900 dark:text-gray-50">{today} alerts</span>
                      const change = Math.round(((today - yesterday) / yesterday) * 100)
                      return (
                        <span className={change >= 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500'}>
                          {change >= 0 ? '+' : ''}{change}% ({today} today)
                        </span>
                      )
                    })()}
                  </span>
                </li>
                {/* Failed Runs - Workflow failure count */}
                <li className="flex w-full items-center justify-between py-2">
                  <span>Failed Runs ({ingestionView})</span>
                  <span className="font-medium">
                    {(() => {
                      const trackerData = ingestionView === '24h' ? hourlyTrackerData : dailyTrackerData
                      const failures = trackerData.filter(d => d.color === 'bg-red-500').length
                      return failures === 0
                        ? <span className="text-emerald-600 dark:text-emerald-500">0 failures</span>
                        : <span className="text-red-600 dark:text-red-500">{failures} failures</span>
                    })()}
                  </span>
                </li>
                {/* By Source - Distribution breakdown based on selected period */}
                <li className="flex w-full items-center justify-between py-2">
                  <span>By Source ({ingestionView})</span>
                  <span className="flex items-center gap-3">
                    {(() => {
                      const periodKey = ingestionView === '24h' ? '24h' : '30d'
                      const vol = data.volumeByPeriod?.[periodKey] || { ethoca: 0, cdrn: 0, rdr: 0 }
                      return (
                        <>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-blue-500" />
                            {vol.ethoca}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-violet-500" />
                            {vol.cdrn}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            {vol.rdr}
                          </span>
                        </>
                      )
                    })()}
                  </span>
                </li>
              </ul>
            </Card>

            {/* Right Column: Volume Trends Chart - Following Tremor area-chart-01 pattern */}
            <Card>
              {/* Section Header */}
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-gray-900 dark:text-gray-50">
                  Alert Volume Trends
                </h3>
                <div className="flex items-center gap-2">
                  <Tabs value={timeBasis} onValueChange={(v) => handleTimeBasisChange(v as 'ingestion' | 'alert')}>
                    <TabsList variant="solid">
                      <TabsTrigger value="ingestion" className="text-xs px-2 py-0.5">Ingested</TabsTrigger>
                      <TabsTrigger value="alert" className="text-xs px-2 py-0.5">Occurred</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Tabs value={trendView} onValueChange={(v) => setTrendView(v as '24h' | '7d' | '30d')}>
                    <TabsList variant="solid">
                      <TabsTrigger value="24h" className="text-xs px-2 py-0.5">24h</TabsTrigger>
                      <TabsTrigger value="7d" className="text-xs px-2 py-0.5">7d</TabsTrigger>
                      <TabsTrigger value="30d" className="text-xs px-2 py-0.5">30d</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {/* Chart - Following Tremor area-chart-01 pattern */}
              <AreaChart
                data={trendData}
                index="time"
                categories={['Ethoca', 'CDRN', 'RDR']}
                colors={['blue', 'violet', 'emerald']}
                showLegend={false}
                showYAxis={false}
                startEndOnly={true}
                fill="solid"
                className="mt-6 h-40"
                customTooltip={AlertVolumeTrendsTooltip}
              />

              {/* Volume Breakdown - Following Tremor area-chart-01 list pattern */}
              <ul
                role="list"
                className="mt-4 divide-y divide-gray-200 text-sm text-gray-500 dark:divide-gray-800 dark:text-gray-500"
              >
                {(() => {
                  const vol = data.volumeByPeriod?.[trendView] || { ethoca: 0, cdrn: 0, rdr: 0 }
                  const total = vol.ethoca + vol.cdrn + vol.rdr
                  return (
                    <>
                      <li className="flex items-center justify-between py-2">
                        <div className="flex items-center space-x-2">
                          <span
                            className="h-[3px] w-3.5 shrink-0 rounded-full bg-blue-500"
                            aria-hidden="true"
                          />
                          <span>Ethoca</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-50">
                          {vol.ethoca.toLocaleString()}
                        </span>
                      </li>
                      <li className="flex items-center justify-between py-2">
                        <div className="flex items-center space-x-2">
                          <span
                            className="h-[3px] w-3.5 shrink-0 rounded-full bg-violet-500"
                            aria-hidden="true"
                          />
                          <span>CDRN</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-50">
                          {vol.cdrn.toLocaleString()}
                        </span>
                      </li>
                      <li className="flex items-center justify-between py-2">
                        <div className="flex items-center space-x-2">
                          <span
                            className="h-[3px] w-3.5 shrink-0 rounded-full bg-emerald-500"
                            aria-hidden="true"
                          />
                          <span>RDR</span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-50">
                          {vol.rdr.toLocaleString()}
                        </span>
                      </li>
                      <li className="flex items-center justify-between py-2">
                        <span className="font-medium text-gray-900 dark:text-gray-50">Total</span>
                        <span className="font-medium text-gray-900 dark:text-gray-50">
                          {total.toLocaleString()}
                        </span>
                      </li>
                    </>
                  )
                })()}
              </ul>

              {/* Divider */}
              <div className="mt-6 h-px w-full bg-gray-200 dark:bg-gray-800" aria-hidden={true} />

              {/* Today vs Yesterday Comparison - Following Tremor kpi-card-27 pattern */}
              <dt className="mt-6 text-sm font-medium text-gray-900 dark:text-gray-50">
                Today vs Yesterday
              </dt>
              <div className="mt-4 flex items-center gap-x-8 gap-y-4">
                <dd className="space-y-3 whitespace-nowrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-sm bg-blue-500 dark:bg-blue-500"
                        aria-hidden="true"
                      />
                      <span className="text-sm text-gray-900 dark:text-gray-50">
                        Today
                      </span>
                    </div>
                    <span className="mt-1 block text-2xl font-semibold text-gray-900 dark:text-gray-50">
                      {data.todayTotal?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-sm bg-gray-400 dark:bg-gray-600"
                        aria-hidden="true"
                      />
                      <span className="text-sm text-gray-900 dark:text-gray-50">
                        Yesterday
                      </span>
                    </div>
                    <span className="mt-1 block text-2xl font-semibold text-gray-900 dark:text-gray-50">
                      {data.yesterdayTotal?.toLocaleString() || 0}
                    </span>
                  </div>
                </dd>
                <LineChart
                  className="h-28 flex-1"
                  data={data.todayVsYesterday?.map(d => {
                    const hour12 = d.hour === 0 ? 12 : d.hour > 12 ? d.hour - 12 : d.hour
                    const ampm = d.hour < 12 ? 'AM' : 'PM'
                    return {
                      ...d,
                      time: `${hour12}:00 ${ampm}`
                    }
                  }) || []}
                  index="time"
                  categories={['Today', 'Yesterday']}
                  colors={['blue', 'gray']}
                  customTooltip={createTodayVsYesterdayTooltip(timezone)}
                  startEndOnly={true}
                  showYAxis={false}
                  showLegend={false}
                  connectNulls={false}
                />
              </div>
            </Card>
          </div>

          {/* Alert Composition Chart + Table */}
          {compositionData.length > 0 && (() => {
            // Aggregate data based on compositionView (day/week/month)
            const aggregateData = (raw: AlertCompositionDay[]) => {
              if (compositionView === 'day') {
                return raw.map(d => ({
                  label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
                  ethoca: d.ethoca,
                  cdrn: d.cdrn,
                  rdr: d.rdr,
                  ethocaEffective: d.ethocaEffective,
                  cdrnEffective: d.cdrnEffective,
                  rdrEffective: d.rdrEffective,
                }))
              }

              const buckets: Record<string, { label: string, ethoca: number, cdrn: number, rdr: number, ethocaEffective: number, cdrnEffective: number, rdrEffective: number }> = {}

              for (const d of raw) {
                const dt = new Date(d.date + 'T00:00:00')
                let key: string
                let label: string

                if (compositionView === 'week') {
                  // Week = Monday to Sunday
                  const day = dt.getDay()
                  const diff = day === 0 ? -6 : 1 - day // offset to Monday
                  const monday = new Date(dt)
                  monday.setDate(dt.getDate() + diff)
                  const sunday = new Date(monday)
                  sunday.setDate(monday.getDate() + 6)
                  key = monday.toISOString().slice(0, 10)
                  label = `${monday.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })} - ${sunday.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}`
                } else {
                  // Month
                  key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
                  label = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                }

                if (!buckets[key]) {
                  buckets[key] = { label, ethoca: 0, cdrn: 0, rdr: 0, ethocaEffective: 0, cdrnEffective: 0, rdrEffective: 0 }
                }
                buckets[key].ethoca += d.ethoca
                buckets[key].cdrn += d.cdrn
                buckets[key].rdr += d.rdr
                buckets[key].ethocaEffective += d.ethocaEffective
                buckets[key].cdrnEffective += d.cdrnEffective
                buckets[key].rdrEffective += d.rdrEffective
              }

              return Object.entries(buckets)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, v]) => v)
            }

            const aggregated = aggregateData(compositionData)

            const chartData = aggregated.map(d => ({
              date: d.label,
              Ethoca: d.ethoca,
              CDRN: d.cdrn,
              RDR: d.rdr,
            }))

            const totalEthoca = aggregated.reduce((s, d) => s + d.ethoca, 0)
            const totalCDRN = aggregated.reduce((s, d) => s + d.cdrn, 0)
            const totalRDR = aggregated.reduce((s, d) => s + d.rdr, 0)
            const totalAll = totalEthoca + totalCDRN + totalRDR
            const totalEffective = aggregated.reduce((s, d) => s + d.ethocaEffective + d.cdrnEffective + d.rdrEffective, 0)
            const totalEthocaEffective = aggregated.reduce((s, d) => s + d.ethocaEffective, 0)
            const totalCDRNEffective = aggregated.reduce((s, d) => s + d.cdrnEffective, 0)
            const totalRDREffective = aggregated.reduce((s, d) => s + d.rdrEffective, 0)

            const pctVal = (num: number, den: number) => den > 0 ? (num / den) * 100 : null
            const pctStr = (num: number, den: number) => den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '-'

            // Heatmap color: red (low) → yellow (mid) → green (high) using Tremor-style palette
            const heatmapBg = (val: number | null) => {
              if (val === null) return ''
              if (val >= 90) return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300'
              if (val >= 80) return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              if (val >= 70) return 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
              if (val >= 60) return 'bg-orange-50 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400'
              return 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400'
            }

            type SummaryRow = {
              name: string
              values: (string | number)[]
              rawValues?: (number | null)[]
              total: string | number
              rawTotal?: number | null
              bgColor: string
              isPercentage?: boolean
            }

            const summaryRows: SummaryRow[] = [
              {
                name: 'All',
                values: aggregated.map(d => d.ethoca + d.cdrn + d.rdr),
                total: totalAll,
                bgColor: 'bg-gray-500',
              },
              {
                name: 'Ethoca',
                values: aggregated.map(d => d.ethoca),
                total: totalEthoca,
                bgColor: 'bg-blue-500',
              },
              {
                name: 'CDRN',
                values: aggregated.map(d => d.cdrn),
                total: totalCDRN,
                bgColor: 'bg-violet-500',
              },
              {
                name: 'RDR',
                values: aggregated.map(d => d.rdr),
                total: totalRDR,
                bgColor: 'bg-fuchsia-500',
              },
              {
                name: 'Overall Effectiveness',
                values: aggregated.map(d => {
                  const t = d.ethoca + d.cdrn + d.rdr
                  const e = d.ethocaEffective + d.cdrnEffective + d.rdrEffective
                  return pctStr(e, t)
                }),
                rawValues: aggregated.map(d => {
                  const t = d.ethoca + d.cdrn + d.rdr
                  const e = d.ethocaEffective + d.cdrnEffective + d.rdrEffective
                  return pctVal(e, t)
                }),
                total: pctStr(totalEffective, totalAll),
                rawTotal: pctVal(totalEffective, totalAll),
                bgColor: 'bg-emerald-500',
                isPercentage: true,
              },
              {
                name: 'Ethoca Effectiveness',
                values: aggregated.map(d => pctStr(d.ethocaEffective, d.ethoca)),
                rawValues: aggregated.map(d => pctVal(d.ethocaEffective, d.ethoca)),
                total: pctStr(totalEthocaEffective, totalEthoca),
                rawTotal: pctVal(totalEthocaEffective, totalEthoca),
                bgColor: 'bg-blue-300',
                isPercentage: true,
              },
              {
                name: 'CDRN Effectiveness',
                values: aggregated.map(d => pctStr(d.cdrnEffective, d.cdrn)),
                rawValues: aggregated.map(d => pctVal(d.cdrnEffective, d.cdrn)),
                total: pctStr(totalCDRNEffective, totalCDRN),
                rawTotal: pctVal(totalCDRNEffective, totalCDRN),
                bgColor: 'bg-violet-300',
                isPercentage: true,
              },
              {
                name: 'RDR Effectiveness',
                values: aggregated.map(d => pctStr(d.rdrEffective, d.rdr)),
                rawValues: aggregated.map(d => pctVal(d.rdrEffective, d.rdr)),
                total: pctStr(totalRDREffective, totalRDR),
                rawTotal: pctVal(totalRDREffective, totalRDR),
                bgColor: 'bg-fuchsia-300',
                isPercentage: true,
              },
            ]

            const dateHeaders = aggregated.map(d => d.label)

            return (
              <Card className="mt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm text-gray-500 dark:text-gray-500">
                      Alert Composition
                    </h3>
                    <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-gray-50">
                      {totalAll.toLocaleString()}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      <span className="text-gray-500 dark:text-gray-500">
                        Ethoca: {totalEthoca.toLocaleString()} &middot; CDRN: {totalCDRN.toLocaleString()} &middot; RDR: {totalRDR.toLocaleString()}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                    {(['day', 'week', 'month'] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setCompositionView(v)}
                        className={cx(
                          'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                          compositionView === v
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        )}
                      >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <LineChart
                  data={chartData}
                  index="date"
                  categories={['Ethoca', 'CDRN', 'RDR']}
                  colors={['blue', 'violet', 'fuchsia']}
                  valueFormatter={(number: number) => Intl.NumberFormat('us').format(number)}
                  yAxisWidth={40}
                  onValueChange={() => {}}
                  className="mt-6 hidden h-80 sm:block"
                />
                <LineChart
                  data={chartData}
                  index="date"
                  categories={['Ethoca', 'CDRN', 'RDR']}
                  colors={['blue', 'violet', 'fuchsia']}
                  valueFormatter={(number: number) => Intl.NumberFormat('us').format(number)}
                  showYAxis={false}
                  showLegend={false}
                  startEndOnly={true}
                  className="mt-6 h-72 sm:hidden"
                />
                <div className="relative mt-8 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-800">
                        <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium text-gray-500 dark:bg-gray-950 dark:text-gray-500 whitespace-nowrap">Type</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-500">Total</th>
                        {dateHeaders.map((dh, i) => (
                          <th key={i} className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-500 whitespace-nowrap">{dh}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map((item) => (
                        <tr key={item.name} className="border-b border-gray-200 dark:border-gray-800">
                          <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-gray-900 dark:bg-gray-950 dark:text-gray-50 whitespace-nowrap">
                            <div className="flex space-x-3">
                              <span
                                className={cx(item.bgColor, 'w-1 shrink-0 rounded')}
                                aria-hidden={true}
                              />
                              <span>{item.name}</span>
                            </div>
                          </td>
                          <td className={cx(
                            'px-4 py-2 text-right font-semibold whitespace-nowrap',
                            item.isPercentage && item.rawTotal != null
                              ? heatmapBg(item.rawTotal)
                              : 'text-gray-900 dark:text-gray-50'
                          )}>
                            {typeof item.total === 'number' ? item.total.toLocaleString() : item.total}
                          </td>
                          {item.values.map((val, i) => (
                            <td key={i} className={cx(
                              'px-4 py-2 text-right whitespace-nowrap',
                              item.isPercentage && item.rawValues?.[i] != null
                                ? heatmapBg(item.rawValues[i])
                                : 'text-gray-700 dark:text-gray-300'
                            )}>
                              {typeof val === 'number' ? val.toLocaleString() : val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          })()}

        </main>
      </div>

      {/* Alert Details Drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          {selectedAlert && (
            <>
              <DrawerHeader>
                <DrawerTitle>Alert Details</DrawerTitle>
                <DrawerDescription>
                  <span className="font-mono">{selectedAlert.alertId}</span>
                </DrawerDescription>
              </DrawerHeader>

              <DrawerBody>
                <div className="space-y-6">
                  {/* Alert Identity */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Alert Identity</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Alert ID</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.alertId || '-'}</dd>
                      <dt className="text-gray-500">Type</dt>
                      <dd>
                        <Badge color={getAlertTypeBadgeColor(selectedAlert.alertType)}>
                          {formatAlertType(selectedAlert.alertType)}
                        </Badge>
                      </dd>
                      <dt className="text-gray-500">Category</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.alertCategory || '-'}</dd>
                      <dt className="text-gray-500">Alert Time</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{formatDateTime(selectedAlert.alertTimestamp)}</dd>
                      <dt className="text-gray-500">Ingested At</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{formatDateTime(selectedAlert.createdAt)}</dd>
                      <dt className="text-gray-500">Age</dt>
                      <dd className="text-gray-900 dark:text-gray-50">
                        {selectedAlert.alertAgeHours !== null ? `${Math.round(selectedAlert.alertAgeHours)} hours` : '-'}
                      </dd>
                      <dt className="text-gray-500">Provider</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.alertProvider || '-'}</dd>
                      <dt className="text-gray-500">Processor</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.alertProcessor || '-'}</dd>
                    </dl>
                  </section>

                  <div className="h-px bg-gray-200 dark:bg-gray-800" />

                  {/* Transaction Details */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Transaction Details</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Amount</dt>
                      <dd className="font-semibold text-gray-900 dark:text-gray-50">
                        {formatCurrency(selectedAlert.transactionAmount, selectedAlert.transactionCurrency)}
                      </dd>
                      <dt className="text-gray-500">Transaction ID</dt>
                      <dd className="font-mono text-xs text-gray-900 dark:text-gray-50 break-all">
                        {selectedAlert.transactionId || '-'}
                      </dd>
                      <dt className="text-gray-500">Transaction Time</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{formatDateTime(selectedAlert.transactionTimestamp)}</dd>
                      <dt className="text-gray-500">Type</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.transactionType || '-'}</dd>
                      <dt className="text-gray-500">ARN</dt>
                      <dd className="font-mono text-xs text-gray-900 dark:text-gray-50">{selectedAlert.arn || '-'}</dd>
                      <dt className="text-gray-500">Auth Code</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.authCode || '-'}</dd>
                      <dt className="text-gray-500">3D Secure</dt>
                      <dd>{renderBooleanIcon(selectedAlert.is3dSecure)}</dd>
                    </dl>
                  </section>

                  <div className="h-px bg-gray-200 dark:bg-gray-800" />

                  {/* Card Information */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Card Information</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Card Number</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">
                        {selectedAlert.cardNumberMasked || (selectedAlert.cardBin && selectedAlert.cardLastFour
                          ? `${selectedAlert.cardBin}••••${selectedAlert.cardLastFour}`
                          : '-')}
                      </dd>
                      <dt className="text-gray-500">BIN</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.cardBin || '-'}</dd>
                      <dt className="text-gray-500">Last 4</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.cardLastFour || '-'}</dd>
                      <dt className="text-gray-500">Card Type</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.cardType || '-'}</dd>
                      <dt className="text-gray-500">Issuer</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.issuer || '-'}</dd>
                    </dl>
                  </section>

                  <div className="h-px bg-gray-200 dark:bg-gray-800" />

                  {/* Merchant & Descriptor */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Merchant & Descriptor</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Descriptor</dt>
                      <dd className="text-gray-900 dark:text-gray-50 break-all">{selectedAlert.merchantDescriptor || '-'}</dd>
                      <dt className="text-gray-500">Member Name</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.merchantMemberName || '-'}</dd>
                      <dt className="text-gray-500">Member ID</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.memberId || '-'}</dd>
                      <dt className="text-gray-500">MCC</dt>
                      <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.mcc || '-'}</dd>
                      <dt className="text-gray-500">Gateway</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.gatewayName || '-'}</dd>
                      <dt className="text-gray-500">Platform</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.platform || '-'}</dd>
                    </dl>
                  </section>

                  <div className="h-px bg-gray-200 dark:bg-gray-800" />

                  {/* Order Matching */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Order Matching</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Order ID</dt>
                      <dd className="font-mono text-xs text-gray-900 dark:text-gray-50 break-all">
                        {selectedAlert.orderId || '-'}
                      </dd>
                      <dt className="text-gray-500">Source</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.orderIdSource || '-'}</dd>
                      <dt className="text-gray-500">Valid Order</dt>
                      <dd className="flex items-center gap-2">
                        {renderBooleanIcon(selectedAlert.isOrderIdValid)}
                        <span className="text-gray-900 dark:text-gray-50">
                          {selectedAlert.isOrderIdValid === true ? 'Yes' : selectedAlert.isOrderIdValid === false ? 'No' : '-'}
                        </span>
                      </dd>
                      <dt className="text-gray-500">CRM</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.crm || '-'}</dd>
                    </dl>
                  </section>

                  <div className="h-px bg-gray-200 dark:bg-gray-800" />

                  {/* Processing Status */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Processing Status</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Status</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.status || '-'}</dd>
                      <dt className="text-gray-500">Post Alert Status</dt>
                      <dd>
                        {selectedAlert.postAlertStatus ? (
                          <Badge color={getOutcomeBadge(selectedAlert).color}>
                            {selectedAlert.postAlertStatus.replace(/_/g, ' ')}
                          </Badge>
                        ) : '-'}
                      </dd>
                      <dt className="text-gray-500">Already Refunded</dt>
                      <dd className="flex items-center gap-2">
                        {renderBooleanIcon(selectedAlert.isAlreadyRefunded)}
                      </dd>
                      <dt className="text-gray-500">Refund Initiated</dt>
                      <dd className="flex items-center gap-2">
                        {renderBooleanIcon(selectedAlert.isRefundInit)}
                        {selectedAlert.refundTimestampInit && (
                          <span className="text-xs text-gray-500">{formatDateTime(selectedAlert.refundTimestampInit)}</span>
                        )}
                      </dd>
                      <dt className="text-gray-500">Refund Confirmed (CRM)</dt>
                      <dd className="flex items-center gap-2">
                        {renderBooleanIcon(selectedAlert.isRefundCrm)}
                        {selectedAlert.refundTimestampCrm && (
                          <span className="text-xs text-gray-500">{formatDateTime(selectedAlert.refundTimestampCrm)}</span>
                        )}
                      </dd>
                      <dt className="text-gray-500">Acknowledged</dt>
                      <dd className="flex items-center gap-2">
                        {renderBooleanIcon(selectedAlert.isAcknowledged)}
                        {selectedAlert.acknowledgementTimestamp && (
                          <span className="text-xs text-gray-500">{formatDateTime(selectedAlert.acknowledgementTimestamp)}</span>
                        )}
                      </dd>
                      <dt className="text-gray-500">Ack Status</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.acknowledgementStatus || '-'}</dd>
                      <dt className="text-gray-500">Ack Refund Status</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.acknowledgementRefundStatus || '-'}</dd>
                      <dt className="text-gray-500">Closed</dt>
                      <dd>{renderBooleanIcon(selectedAlert.isClosed)}</dd>
                      <dt className="text-gray-500">Blacklisted</dt>
                      <dd>{renderBooleanIcon(selectedAlert.isBlacklisted)}</dd>
                      <dt className="text-gray-500">Fraud</dt>
                      <dd>{renderBooleanIcon(selectedAlert.isFraud)}</dd>
                    </dl>
                  </section>

                  {/* Dispute Details (if applicable) */}
                  {(selectedAlert.caseType || selectedAlert.reasonCode) && (
                    <>
                      <div className="h-px bg-gray-200 dark:bg-gray-800" />
                      <section>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Dispute Details</h4>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <dt className="text-gray-500">Case Type</dt>
                          <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.caseType || '-'}</dd>
                          <dt className="text-gray-500">Case Amount</dt>
                          <dd className="text-gray-900 dark:text-gray-50">
                            {selectedAlert.caseAmount !== null ? formatCurrency(selectedAlert.caseAmount, selectedAlert.transactionCurrency) : '-'}
                          </dd>
                          <dt className="text-gray-500">Reason Code</dt>
                          <dd className="font-mono text-gray-900 dark:text-gray-50">{selectedAlert.reasonCode || '-'}</dd>
                          <dt className="text-gray-500">Reason Description</dt>
                          <dd className="text-gray-900 dark:text-gray-50 text-xs">{selectedAlert.reasonCodeDescription || '-'}</dd>
                        </dl>
                      </section>
                    </>
                  )}

                  <div className="h-px bg-gray-200 dark:bg-gray-800" />

                  {/* Metadata */}
                  <section>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50 mb-3">Metadata</h4>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <dt className="text-gray-500">Source</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.source || '-'}</dd>
                      <dt className="text-gray-500">Data Source</dt>
                      <dd className="text-gray-900 dark:text-gray-50">{selectedAlert.dataSource || '-'}</dd>
                      <dt className="text-gray-500">Alert Cost</dt>
                      <dd className="text-gray-900 dark:text-gray-50">
                        {selectedAlert.alertCost > 0 ? formatCurrency(selectedAlert.alertCost, 'USD') : '-'}
                      </dd>
                      <dt className="text-gray-500">Alert Price</dt>
                      <dd className="text-gray-900 dark:text-gray-50">
                        {selectedAlert.alertPrice > 0 ? formatCurrency(selectedAlert.alertPrice, 'USD') : '-'}
                      </dd>
                    </dl>
                  </section>
                </div>
              </DrawerBody>

              <DrawerFooter>
                <DrawerClose asChild>
                  <button className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-100 ease-in-out hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900">
                    Close
                  </button>
                </DrawerClose>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

