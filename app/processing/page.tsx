'use client'

import { Card } from '@/components/Card'
import { BarList } from '@/components/BarList'
import { ProgressBar } from '@/components/ProgressBar'
import { CategoryBar } from '@/components/CategoryBar'
import { Divider } from '@/components/Divider'
import { DonutChart } from '@/components/DonutChart'
import { ProgressCircle } from '@/components/ProgressCircle'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/Tabs'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRoot } from '@/components/Table'
import { Badge } from '@/components/Badge'
import { DateRangePicker, type DateRange } from '@/components/DatePicker'
import { Switch } from '@/components/Switch'
import { TimezoneToggle, useTimezone, type Timezone } from '@/components/TimezoneToggle'
import { formatDateLocal } from '@/lib/utils'
import {
  RiSunLine,
  RiMoonLine,
  RiRefreshLine,
  RiLoader4Line,
  RiArrowUpSFill,
  RiArrowDownSFill,
  RiCheckboxCircleFill,
  RiTimeLine,
  RiAlertLine,
  RiArrowRightLine
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useEffect, useState, useCallback } from 'react'
import { AlertsDataTable, AlertDetailsDrawer, type Alert } from '@/components/ui/alerts-data-table'
import { NotificationsPanel } from '@/components/ui/operations-alerts'

// Types for Alerts Summary (from alerts_raw table)
interface AlertsByType {
  total: number
  ethoca: number
  cdrn: number
  rdr: number
}

interface AlertsByOutcome {
  total: number
  effective: number
  invalidOrder: number
  alreadyRefunded: number
  notRefunded: number
  turnedIntoCB: number
}

interface AlertsSummary {
  alertsByType: AlertsByType
  alertsByOutcome: AlertsByOutcome
}

// Types for Processing Data
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
  // Step 3: Fallout checks
  alreadyRefunded: number
  alreadyChargeback: number
  unableToRefund: number
  validNotFallout: number
  // Step 4: Blacklist status
  validBlacklisted: number
  validNotBlacklisted: number
  // Legacy fields
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
  // Pipeline flow fields
  validOrder: number
  invalidOrder: number
  alreadyRefunded: number
  notAlreadyRefunded: number
  unableToRefund: number
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

interface OpsData {
  dateRange: { start: string; end: string }
  volumeSummary: VolumeSummary
  processingTime: ProcessingTime
  rdrFlow: RDRFlow
  cdrnFlow: CDRNFlow
  ethocaFlow: EthocaFlow
  alertsNeedingAttention: AlertNeedingAttention[]
}

export default function ProcessingDashboard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<OpsData | null>(null)
  const [alertsSummary, setAlertsSummary] = useState<AlertsSummary | null>(null)
  const [ethocaOnlyOutcome, setEthocaOnlyOutcome] = useState(false)
  const [ethocaOutcomeData, setEthocaOutcomeData] = useState<AlertsByOutcome | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [userChangedDate, setUserChangedDate] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [timezone, setTimezone, timezoneLoaded] = useTimezone()

  // Alert drawer state
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleAlertClick = (alert: Alert) => {
    setSelectedAlert(alert)
    setDrawerOpen(true)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch alerts summary from alerts_raw table (using alert_timestamp for Processing tab)
  const fetchAlertsSummary = useCallback(async (range?: DateRange, tz?: Timezone) => {
    try {
      // Use dateColumn=alert_timestamp for Processing tab
      const tzParam = tz || timezone
      let url = `/api/alerts?groupBy=bin&dateColumn=alert_timestamp&timezone=${tzParam}`
      if (range?.from && range?.to) {
        url += `&startDate=${formatDateLocal(range.from)}&endDate=${formatDateLocal(range.to)}`
      }
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to fetch alerts summary')
      const result = await response.json()
      setAlertsSummary({
        alertsByType: result.alertsByType,
        alertsByOutcome: result.alertsByOutcome
      })
      return result
    } catch (err) {
      console.error('Failed to fetch alerts summary:', err)
      return null
    }
  }, [timezone])

  // Fetch Ethoca-only outcome data for the toggle filter
  const fetchEthocaOutcomeData = useCallback(async (range?: DateRange, tz?: Timezone) => {
    try {
      const tzParam = tz || timezone
      let url = `/api/alerts?groupBy=bin&dateColumn=alert_timestamp&alertType=ethoca&timezone=${tzParam}`
      if (range?.from && range?.to) {
        url += `&startDate=${formatDateLocal(range.from)}&endDate=${formatDateLocal(range.to)}`
      }
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to fetch Ethoca outcome data')
      const result = await response.json()
      setEthocaOutcomeData(result.alertsByOutcome)
      return result.alertsByOutcome
    } catch (err) {
      console.error('Failed to fetch Ethoca outcome data:', err)
      return null
    }
  }, [timezone])

  const fetchData = useCallback(async (range?: DateRange, tz?: Timezone) => {
    try {
      setLoading(true)
      const tzParam = tz || timezone
      const params = new URLSearchParams()
      params.set('timezone', tzParam)
      if (range?.from && range?.to) {
        params.set('startDate', formatDateLocal(range.from))
        params.set('endDate', formatDateLocal(range.to))
      }
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
  }, [timezone])

  useEffect(() => {
    // Wait for timezone to be loaded from localStorage before fetching
    if (!timezoneLoaded) return

    // Fetch both processing data and alerts summary with correct timezone
    Promise.all([
      fetchData(undefined, timezone),
      fetchAlertsSummary(undefined, timezone)
    ]).then(([result]) => {
      if (result?.dateRange) {
        setDateRange({
          from: new Date(result.dateRange.start),
          to: new Date(result.dateRange.end)
        })
      }
    })
  }, [timezoneLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDateRangeChange = (newRange: DateRange | undefined) => {
    setDateRange(newRange)
    setUserChangedDate(true)
  }

  useEffect(() => {
    if (userChangedDate && dateRange?.from && dateRange?.to) {
      // Fetch both when date changes with current timezone
      fetchData(dateRange, timezone)
      fetchAlertsSummary(dateRange, timezone)
      if (ethocaOnlyOutcome) {
        fetchEthocaOutcomeData(dateRange, timezone)
      }
      setUserChangedDate(false)
    }
  }, [userChangedDate, dateRange, timezone, fetchData, fetchAlertsSummary, ethocaOnlyOutcome, fetchEthocaOutcomeData])

  // Handle Ethoca toggle change
  const handleEthocaToggle = (checked: boolean) => {
    setEthocaOnlyOutcome(checked)
    if (checked && !ethocaOutcomeData) {
      fetchEthocaOutcomeData(dateRange, timezone)
    }
  }

  // Handle timezone change
  const handleTimezoneChange = (newTimezone: Timezone) => {
    setTimezone(newTimezone)
    // Refetch all data with new timezone
    fetchData(dateRange, newTimezone)
    fetchAlertsSummary(dateRange, newTimezone)
    if (ethocaOnlyOutcome) {
      fetchEthocaOutcomeData(dateRange, newTimezone)
    }
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const formatHours = (hours: number | null) => {
    if (hours === null) return 'N/A'
    if (hours < 1) return `${Math.round(hours * 60)} min`
    return `${hours.toFixed(1)} hrs`
  }

  // Calculate derived values for Alerts by Type card
  const typePercentages = alertsSummary?.alertsByType ? {
    ethoca: alertsSummary.alertsByType.total > 0 ? Math.round((alertsSummary.alertsByType.ethoca / alertsSummary.alertsByType.total) * 100) : 0,
    cdrn: alertsSummary.alertsByType.total > 0 ? Math.round((alertsSummary.alertsByType.cdrn / alertsSummary.alertsByType.total) * 100) : 0,
    rdr: alertsSummary.alertsByType.total > 0 ? Math.round((alertsSummary.alertsByType.rdr / alertsSummary.alertsByType.total) * 100) : 0,
  } : { ethoca: 0, cdrn: 0, rdr: 0 }

  // Calculate derived values for Alerts by Outcome card
  // Use Ethoca-only data when toggle is enabled, otherwise use all alerts data
  const activeOutcomeData = ethocaOnlyOutcome && ethocaOutcomeData ? ethocaOutcomeData : alertsSummary?.alertsByOutcome

  const effectivenessRate = activeOutcomeData?.total && activeOutcomeData.total > 0
    ? ((activeOutcomeData.effective / activeOutcomeData.total) * 100).toFixed(1)
    : '0.0'

  const outcomePercentages = activeOutcomeData ? {
    effective: activeOutcomeData.total > 0 ? Math.round((activeOutcomeData.effective / activeOutcomeData.total) * 100) : 0,
    invalidOrder: activeOutcomeData.total > 0 ? Math.round((activeOutcomeData.invalidOrder / activeOutcomeData.total) * 100) : 0,
    alreadyRefunded: activeOutcomeData.total > 0 ? Math.round((activeOutcomeData.alreadyRefunded / activeOutcomeData.total) * 100) : 0,
    notRefunded: activeOutcomeData.total > 0 ? Math.round((activeOutcomeData.notRefunded / activeOutcomeData.total) * 100) : 0,
    turnedIntoCB: activeOutcomeData.total > 0 ? Math.round((activeOutcomeData.turnedIntoCB / activeOutcomeData.total) * 100) : 0,
  } : { effective: 0, invalidOrder: 0, alreadyRefunded: 0, notRefunded: 0, turnedIntoCB: 0 }

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <div className="flex items-center gap-3 text-gray-500">
          <RiLoader4Line className="size-6 animate-spin" />
          <span>Loading processing data...</span>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <div className="text-center text-red-500">
          <p>Failed to load processing data</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

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
              onClick={() => {
                fetchData(dateRange, timezone)
                fetchAlertsSummary(dateRange, timezone)
              }}
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
            <TabNavigationLink href="/workflow">Ingestion</TabNavigationLink>
            <TabNavigationLink href="/processing" active={true}>Processing</TabNavigationLink>
          </div>
        </TabNavigation>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <main>
          {/* Alerts Summary Cards - from alerts_raw table */}
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Card 1 - Alerts by Type */}
            <Card>
              <dt className="text-sm font-medium text-gray-900 dark:text-gray-50">
                Alerts by Type
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-gray-50">
                {alertsSummary?.alertsByType?.total ?? 0}
              </dd>
              <CategoryBar
                values={[alertsSummary?.alertsByType?.ethoca ?? 0, alertsSummary?.alertsByType?.cdrn ?? 0, alertsSummary?.alertsByType?.rdr ?? 0]}
                className="mt-6"
                colors={['blue', 'gray', 'rose']}
                showLabels={false}
              />
              <ul role="list" className="mt-4 space-y-3 text-sm">
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-blue-500" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">ETHOCA</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {alertsSummary?.alertsByType?.ethoca ?? 0} ({typePercentages.ethoca}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-400 dark:bg-gray-600" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">CDRN</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {alertsSummary?.alertsByType?.cdrn ?? 0} ({typePercentages.cdrn}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-rose-500" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">RDR</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {alertsSummary?.alertsByType?.rdr ?? 0} ({typePercentages.rdr}%)
                  </span>
                </li>
              </ul>
            </Card>

            {/* Card 2 - Alerts by Outcome */}
            <Card>
              <div className="flex items-center justify-between">
                <dt className="text-sm font-medium text-gray-900 dark:text-gray-50">
                  Alerts by Outcome
                </dt>
                <div className="flex items-center gap-2">
                  <label htmlFor="ethoca-toggle" className="text-xs text-gray-500 dark:text-gray-400">
                    Ethoca only
                  </label>
                  <Switch
                    id="ethoca-toggle"
                    size="small"
                    checked={ethocaOnlyOutcome}
                    onCheckedChange={handleEthocaToggle}
                  />
                </div>
              </div>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-gray-900 dark:text-gray-50">
                  {effectivenessRate}%
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">Effectiveness rate</span>
              </dd>
              <CategoryBar
                values={[
                  activeOutcomeData?.effective ?? 0,
                  activeOutcomeData?.invalidOrder ?? 0,
                  activeOutcomeData?.alreadyRefunded ?? 0,
                  activeOutcomeData?.notRefunded ?? 0,
                  activeOutcomeData?.turnedIntoCB ?? 0,
                ]}
                className="mt-6"
                colors={['emerald', 'gray', 'grayLight', 'grayLighter', 'grayLightest']}
                showLabels={false}
              />
              <ul role="list" className="mt-4 space-y-3 text-sm">
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-emerald-500" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Effective alerts</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {activeOutcomeData?.effective ?? 0} ({outcomePercentages.effective}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-400 dark:bg-gray-600" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts with invalid order</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {activeOutcomeData?.invalidOrder ?? 0} ({outcomePercentages.invalidOrder}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-300 dark:bg-gray-700" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts already refunded</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {activeOutcomeData?.alreadyRefunded ?? 0} ({outcomePercentages.alreadyRefunded}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts not refunded in CRM</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {activeOutcomeData?.notRefunded ?? 0} ({outcomePercentages.notRefunded}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-100 dark:bg-gray-900" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts turned into CB</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {activeOutcomeData?.turnedIntoCB ?? 0} ({outcomePercentages.turnedIntoCB}%)
                  </span>
                </li>
              </ul>
            </Card>

            {/* Card 3 - Processing Efficiency */}
            <Card>
              <div className="flex items-center justify-between">
                <dt className="text-sm font-medium text-gray-900 dark:text-gray-50">
                  Processing Efficiency
                </dt>
                <Badge
                  variant={
                    (() => {
                      const cdrnTime = data.processingTime.cdrnAvgTimeToCrmRefund || 0
                      const ethocaTime = data.processingTime.ethocaAvgTimeToCrmRefund || 0
                      const ackTime = data.processingTime.ethocaAvgTimeToAcknowledge || 0
                      const allWithinSLA = cdrnTime <= 24 && ethocaTime <= 24 && ackTime <= 24
                      return allWithinSLA ? 'success' : 'warning'
                    })()
                  }
                >
                  {(() => {
                    const cdrnTime = data.processingTime.cdrnAvgTimeToCrmRefund || 0
                    const ethocaTime = data.processingTime.ethocaAvgTimeToCrmRefund || 0
                    const ackTime = data.processingTime.ethocaAvgTimeToAcknowledge || 0
                    const withinSLA = [cdrnTime <= 24, ethocaTime <= 24, ackTime <= 24].filter(Boolean).length
                    return `${withinSLA}/3 SLA`
                  })()}
                </Badge>
              </div>

              {/* Progress items */}
              <ul role="list" className="mt-6 space-y-5">
                {/* CDRN Refund Time */}
                <li>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">CDRN Refund</span>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                      {formatHours(data.processingTime.cdrnAvgTimeToCrmRefund)}/24h
                    </span>
                  </div>
                  <ProgressBar
                    value={Math.min(((data.processingTime.cdrnAvgTimeToCrmRefund || 0) / 24) * 100, 100)}
                    color={(data.processingTime.cdrnAvgTimeToCrmRefund || 0) <= 12 ? 'emerald' : (data.processingTime.cdrnAvgTimeToCrmRefund || 0) <= 20 ? 'amber' : 'red'}
                    className="mt-2"
                  />
                </li>

                {/* Ethoca Refund Time */}
                <li>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Ethoca Refund</span>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                      {formatHours(data.processingTime.ethocaAvgTimeToCrmRefund)}/24h
                    </span>
                  </div>
                  <ProgressBar
                    value={Math.min(((data.processingTime.ethocaAvgTimeToCrmRefund || 0) / 24) * 100, 100)}
                    color={(data.processingTime.ethocaAvgTimeToCrmRefund || 0) <= 12 ? 'emerald' : (data.processingTime.ethocaAvgTimeToCrmRefund || 0) <= 20 ? 'amber' : 'red'}
                    className="mt-2"
                  />
                </li>

                {/* Ethoca Acknowledge Time */}
                <li>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Ethoca Acknowledge</span>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-50">
                      {formatHours(data.processingTime.ethocaAvgTimeToAcknowledge)}/24h
                    </span>
                  </div>
                  <ProgressBar
                    value={Math.min(((data.processingTime.ethocaAvgTimeToAcknowledge || 0) / 24) * 100, 100)}
                    color={(data.processingTime.ethocaAvgTimeToAcknowledge || 0) <= 12 ? 'emerald' : (data.processingTime.ethocaAvgTimeToAcknowledge || 0) <= 20 ? 'amber' : 'red'}
                    className="mt-2"
                  />
                </li>
              </ul>

              <p className="mt-6 text-xs text-gray-500 dark:text-gray-500 text-center">
                Target: 24 hour SLA for all metrics
              </p>
            </Card>
          </dl>

          {/* Processing Pipeline Status */}
          <Card className="mt-6">
            <h3 className="font-medium text-gray-900 dark:text-gray-50 mb-6">Processing Pipeline Status</h3>

            <Tabs defaultValue="rdr">
              <TabsList className="mb-6">
                <TabsTrigger value="rdr">
                  RDR
                  <span className="ml-2 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums dark:bg-gray-800">
                    {data.rdrFlow.received}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="cdrn">
                  CDRN
                  <span className="ml-2 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums dark:bg-gray-800">
                    {data.cdrnFlow.received}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="ethoca">
                  Ethoca
                  <span className="ml-2 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums dark:bg-gray-800">
                    {data.ethocaFlow.received}
                  </span>
                </TabsTrigger>
              </TabsList>

              {/* RDR Pipeline - Scenario Analysis Design */}
              <TabsContent value="rdr">
                <section className="relative overflow-x-auto py-4">
                  <div className="relative grid min-w-[56rem] grid-cols-9">
                    {/* Step 1: Total Alerts */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        1. Total Alerts
                      </h2>
                      <div className="flex justify-center">
                        <ProgressCircle
                          radius={45}
                          strokeWidth={6}
                          value={100}
                        >
                          <div className="flex flex-col items-center pt-2">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.rdrFlow.received.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                              100%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                    </div>

                    {/* Connector 1 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 2: Order Validation */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        2. Order Validation
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.received > 0 ? (data.rdrFlow.validOrderId / data.rdrFlow.received) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.rdrFlow.validOrderId.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500">
                                {data.rdrFlow.received > 0 ? ((data.rdrFlow.validOrderId / data.rdrFlow.received) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Valid</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.received > 0 ? ((data.rdrFlow.invalidOrderId + data.rdrFlow.missingOrderId) / data.rdrFlow.received) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {(data.rdrFlow.invalidOrderId + data.rdrFlow.missingOrderId).toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {data.rdrFlow.received > 0 ? (((data.rdrFlow.invalidOrderId + data.rdrFlow.missingOrderId) / data.rdrFlow.received) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Invalid</p>
                      </div>
                    </div>

                    {/* Connector 2 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 3: Already Refunded? */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        3. Already Refunded?
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.validOrderId > 0 ? (data.rdrFlow.validNotRefunded / data.rdrFlow.validOrderId) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.rdrFlow.validNotRefunded.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500">
                                {data.rdrFlow.validOrderId > 0 ? ((data.rdrFlow.validNotRefunded / data.rdrFlow.validOrderId) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">RDR Processed</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.validOrderId > 0 ? (data.rdrFlow.validAlreadyRefunded / data.rdrFlow.validOrderId) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.rdrFlow.validAlreadyRefunded.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {data.rdrFlow.validOrderId > 0 ? ((data.rdrFlow.validAlreadyRefunded / data.rdrFlow.validOrderId) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Already Refunded</p>
                      </div>
                    </div>

                    {/* Connector 3 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 4: Blacklist Status */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        4. Blacklist Status
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.validNotRefunded > 0 ? (data.rdrFlow.validBlacklisted / data.rdrFlow.validNotRefunded) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.rdrFlow.validBlacklisted.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500">
                                {data.rdrFlow.validNotRefunded > 0 ? ((data.rdrFlow.validBlacklisted / data.rdrFlow.validNotRefunded) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Blacklisted</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.validNotRefunded > 0 ? (data.rdrFlow.validNotBlacklisted / data.rdrFlow.validNotRefunded) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.rdrFlow.validNotBlacklisted.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {data.rdrFlow.validNotRefunded > 0 ? ((data.rdrFlow.validNotBlacklisted / data.rdrFlow.validNotRefunded) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Not Blacklisted</p>
                      </div>
                    </div>

                    {/* Connector 4 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 5: Effectiveness */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        5. Effectiveness
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.rdrFlow.effectivenessRate}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.rdrFlow.effective.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                                {data.rdrFlow.effectivenessRate}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Effective</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="error"
                            radius={45}
                            strokeWidth={6}
                            value={100 - data.rdrFlow.effectivenessRate}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {(data.rdrFlow.received - data.rdrFlow.effective).toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {100 - data.rdrFlow.effectivenessRate}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Not Effective</p>
                      </div>
                    </div>
                  </div>
                </section>

              </TabsContent>

              {/* CDRN Pipeline - Scenario Analysis Design (same as RDR) */}
              <TabsContent value="cdrn">
                <section className="relative overflow-x-auto py-4">
                  <div className="relative grid min-w-[56rem] grid-cols-9">
                    {/* Step 1: Total Alerts */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        1. Total Alerts
                      </h2>
                      <div className="flex justify-center">
                        <ProgressCircle
                          radius={45}
                          strokeWidth={6}
                          value={100}
                        >
                          <div className="flex flex-col items-center pt-2">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.cdrnFlow.received.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                              100%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                    </div>

                    {/* Connector 1 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 2: Order Validation */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        2. Order Validation
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.cdrnFlow.received > 0 ? (data.cdrnFlow.orderMatched / data.cdrnFlow.received) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.cdrnFlow.orderMatched.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500">
                                {data.cdrnFlow.received > 0 ? ((data.cdrnFlow.orderMatched / data.cdrnFlow.received) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Valid</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={45}
                            strokeWidth={6}
                            value={data.cdrnFlow.received > 0 ? (data.cdrnFlow.orderNotMatched / data.cdrnFlow.received) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.cdrnFlow.orderNotMatched.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {data.cdrnFlow.received > 0 ? ((data.cdrnFlow.orderNotMatched / data.cdrnFlow.received) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Invalid</p>
                      </div>
                    </div>

                    {/* Connector 2 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-24 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 3: Fallout Checks */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        3. Fallout Checks
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.cdrnFlow.orderMatched > 0 ? (data.cdrnFlow.validNotFallout / data.cdrnFlow.orderMatched) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.cdrnFlow.validNotFallout.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500">
                                {data.cdrnFlow.orderMatched > 0 ? ((data.cdrnFlow.validNotFallout / data.cdrnFlow.orderMatched) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Refund Processed</p>
                      </div>
                      {/* Three small fallout donuts - centered with other bottom donuts */}
                      <div className="mt-4 pt-5 flex justify-center items-start gap-2">
                        {/* Already Refunded */}
                        <div className="flex flex-col items-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={26}
                            strokeWidth={4}
                            value={data.cdrnFlow.orderMatched > 0 ? (data.cdrnFlow.alreadyRefunded / data.cdrnFlow.orderMatched) * 100 : 0}
                          >
                            <span className="text-xs font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.cdrnFlow.alreadyRefunded}
                            </span>
                          </ProgressCircle>
                          <p className="mt-2 text-center text-[10px] text-gray-600 dark:text-gray-400 leading-tight">Already<br/>Refunded</p>
                        </div>
                        {/* Already Chargeback */}
                        <div className="flex flex-col items-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={26}
                            strokeWidth={4}
                            value={data.cdrnFlow.orderMatched > 0 ? (data.cdrnFlow.alreadyChargeback / data.cdrnFlow.orderMatched) * 100 : 0}
                          >
                            <span className="text-xs font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.cdrnFlow.alreadyChargeback}
                            </span>
                          </ProgressCircle>
                          <p className="mt-2 text-center text-[10px] text-gray-600 dark:text-gray-400 leading-tight">Already<br/>CB</p>
                        </div>
                        {/* Unable to Refund */}
                        <div className="flex flex-col items-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={26}
                            strokeWidth={4}
                            value={data.cdrnFlow.orderMatched > 0 ? (data.cdrnFlow.unableToRefund / data.cdrnFlow.orderMatched) * 100 : 0}
                          >
                            <span className="text-xs font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.cdrnFlow.unableToRefund}
                            </span>
                          </ProgressCircle>
                          <p className="mt-2 text-center text-[10px] text-gray-600 dark:text-gray-400 leading-tight">Unable<br/>Refund</p>
                        </div>
                      </div>
                    </div>

                    {/* Connector 3 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 4: Blacklist Status */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        4. Blacklist Status
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.cdrnFlow.validNotFallout > 0 ? (data.cdrnFlow.validBlacklisted / data.cdrnFlow.validNotFallout) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.cdrnFlow.validBlacklisted.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500">
                                {data.cdrnFlow.validNotFallout > 0 ? ((data.cdrnFlow.validBlacklisted / data.cdrnFlow.validNotFallout) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Blacklisted</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="neutral"
                            radius={45}
                            strokeWidth={6}
                            value={data.cdrnFlow.validNotFallout > 0 ? (data.cdrnFlow.validNotBlacklisted / data.cdrnFlow.validNotFallout) * 100 : 0}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.cdrnFlow.validNotBlacklisted.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {data.cdrnFlow.validNotFallout > 0 ? ((data.cdrnFlow.validNotBlacklisted / data.cdrnFlow.validNotFallout) * 100).toFixed(0) : 0}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Not Blacklisted</p>
                      </div>
                    </div>

                    {/* Connector 4 */}
                    <div className="mt-24 min-w-20">
                      <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                      <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                    </div>

                    {/* Step 5: Effectiveness */}
                    <div className="flex flex-col items-center gap-6">
                      <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                        5. Effectiveness
                      </h2>
                      <div>
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="success"
                            radius={45}
                            strokeWidth={6}
                            value={data.cdrnFlow.effectivenessRate}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {data.cdrnFlow.effective.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                                {data.cdrnFlow.effectivenessRate}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Effective</p>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-center">
                          <ProgressCircle
                            variant="error"
                            radius={45}
                            strokeWidth={6}
                            value={100 - data.cdrnFlow.effectivenessRate}
                          >
                            <div className="flex flex-col items-center">
                              <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                                {(data.cdrnFlow.received - data.cdrnFlow.effective).toLocaleString()}
                              </span>
                              <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                                {100 - data.cdrnFlow.effectivenessRate}%
                              </span>
                            </div>
                          </ProgressCircle>
                        </div>
                        <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Not Effective</p>
                      </div>
                    </div>
                  </div>
                </section>

              </TabsContent>

              {/* Ethoca Pipeline - 5 Step Flow */}
              <TabsContent value="ethoca">
                <section className="relative overflow-x-auto py-4">
                <div className="relative grid min-w-[56rem] grid-cols-9">
                  {/* Step 1: Total Alerts */}
                  <div className="flex flex-col items-center gap-6">
                    <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                      1. Total Alerts
                    </h2>
                    <div>
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="default"
                          radius={45}
                          strokeWidth={6}
                          value={100}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.received.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500">
                              100%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Received</p>
                    </div>
                  </div>

                  {/* Connector 1 */}
                  <div className="mt-24 min-w-20">
                    <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                  </div>

                  {/* Step 2: Order Validation */}
                  <div className="flex flex-col items-center gap-6">
                    <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                      2. Order Validation
                    </h2>
                    <div>
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="success"
                          radius={45}
                          strokeWidth={6}
                          value={data.ethocaFlow.received > 0 ? (data.ethocaFlow.validOrder / data.ethocaFlow.received) * 100 : 0}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.validOrder.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500">
                              {data.ethocaFlow.received > 0 ? ((data.ethocaFlow.validOrder / data.ethocaFlow.received) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Valid</p>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="neutral"
                          radius={45}
                          strokeWidth={6}
                          value={data.ethocaFlow.received > 0 ? (data.ethocaFlow.invalidOrder / data.ethocaFlow.received) * 100 : 0}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.invalidOrder.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                              {data.ethocaFlow.received > 0 ? ((data.ethocaFlow.invalidOrder / data.ethocaFlow.received) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Invalid</p>
                    </div>
                  </div>

                  {/* Connector 2 */}
                  <div className="mt-24 min-w-20">
                    <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                  </div>

                  {/* Step 3: Already Refunded? */}
                  <div className="flex flex-col items-center gap-6">
                    <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                      3. Already Refunded?
                    </h2>
                    <div>
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="success"
                          radius={45}
                          strokeWidth={6}
                          value={data.ethocaFlow.validOrder > 0 ? (data.ethocaFlow.notAlreadyRefunded / data.ethocaFlow.validOrder) * 100 : 0}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.notAlreadyRefunded.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500">
                              {data.ethocaFlow.validOrder > 0 ? ((data.ethocaFlow.notAlreadyRefunded / data.ethocaFlow.validOrder) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Not Refunded</p>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="neutral"
                          radius={45}
                          strokeWidth={6}
                          value={data.ethocaFlow.validOrder > 0 ? (data.ethocaFlow.alreadyRefunded / data.ethocaFlow.validOrder) * 100 : 0}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.alreadyRefunded.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                              {data.ethocaFlow.validOrder > 0 ? ((data.ethocaFlow.alreadyRefunded / data.ethocaFlow.validOrder) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Already Refunded</p>
                    </div>
                  </div>

                  {/* Connector 3 */}
                  <div className="mt-24 min-w-20">
                    <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                  </div>

                  {/* Step 4: Refund Processing */}
                  <div className="flex flex-col items-center gap-6">
                    <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                      4. Refund Processing
                    </h2>
                    <div>
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="success"
                          radius={45}
                          strokeWidth={6}
                          value={data.ethocaFlow.notAlreadyRefunded > 0 ? (data.ethocaFlow.effective / data.ethocaFlow.notAlreadyRefunded) * 100 : 0}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.effective.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500">
                              {data.ethocaFlow.notAlreadyRefunded > 0 ? ((data.ethocaFlow.effective / data.ethocaFlow.notAlreadyRefunded) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Refund Processed</p>
                    </div>
                    {/* Two small fallout donuts */}
                    <div className="mt-4 pt-5 flex justify-center items-start gap-2">
                      {/* Unable to Refund */}
                      <div className="flex flex-col items-center">
                        <ProgressCircle
                          variant="neutral"
                          radius={26}
                          strokeWidth={4}
                          value={data.ethocaFlow.notAlreadyRefunded > 0 ? (data.ethocaFlow.unableToRefund / data.ethocaFlow.notAlreadyRefunded) * 100 : 0}
                        >
                          <span className="text-xs font-medium tabular-nums text-gray-900 dark:text-gray-50">
                            {data.ethocaFlow.unableToRefund}
                          </span>
                        </ProgressCircle>
                        <p className="mt-2 text-center text-[10px] text-gray-600 dark:text-gray-400 leading-tight">Unable<br/>Refund</p>
                      </div>
                      {/* Turned to Chargeback */}
                      <div className="flex flex-col items-center">
                        <ProgressCircle
                          variant="error"
                          radius={26}
                          strokeWidth={4}
                          value={data.ethocaFlow.notAlreadyRefunded > 0 ? (data.ethocaFlow.turnedToCB / data.ethocaFlow.notAlreadyRefunded) * 100 : 0}
                        >
                          <span className="text-xs font-medium tabular-nums text-gray-900 dark:text-gray-50">
                            {data.ethocaFlow.turnedToCB}
                          </span>
                        </ProgressCircle>
                        <p className="mt-2 text-center text-[10px] text-gray-600 dark:text-gray-400 leading-tight">Turned<br/>to CB</p>
                      </div>
                    </div>
                  </div>

                  {/* Connector 4 */}
                  <div className="mt-24 min-w-20">
                    <div className="w-full border-t border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="mx-auto h-40 w-px border-l border-dashed border-gray-300 dark:border-gray-700" />
                    <div className="ml-auto w-1/2 border-t border-dashed border-gray-300 dark:border-gray-700" />
                  </div>

                  {/* Step 5: Effectiveness */}
                  <div className="flex flex-col items-center gap-6">
                    <h2 className="text-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                      5. Effectiveness
                    </h2>
                    <div>
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="success"
                          radius={45}
                          strokeWidth={6}
                          value={data.ethocaFlow.effectivenessRate}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {data.ethocaFlow.effective.toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500">
                              {data.ethocaFlow.effectivenessRate}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Effective</p>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-center">
                        <ProgressCircle
                          variant="neutral"
                          radius={45}
                          strokeWidth={6}
                          value={100 - data.ethocaFlow.effectivenessRate}
                        >
                          <div className="flex flex-col items-center">
                            <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                              {(data.ethocaFlow.received - data.ethocaFlow.effective).toLocaleString()}
                            </span>
                            <span className="text-xs font-medium tabular-nums text-gray-500 dark:text-gray-500">
                              {data.ethocaFlow.received > 0 ? (100 - data.ethocaFlow.effectivenessRate) : 0}%
                            </span>
                          </div>
                        </ProgressCircle>
                      </div>
                      <p className="mt-4 text-center text-sm text-gray-700 dark:text-gray-300">Non-effective</p>
                    </div>
                  </div>
                </div>
                </section>

              </TabsContent>
            </Tabs>
          </Card>

          {/* All Alerts Table */}
          <Card className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-50">All Alerts</h3>
                <p className="text-sm text-gray-500">Complete list of alerts for the selected period</p>
              </div>
            </div>
            <AlertsDataTable
              startDate={dateRange?.from ? formatDateLocal(dateRange.from) : formatDateLocal(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))}
              endDate={dateRange?.to ? formatDateLocal(dateRange.to) : formatDateLocal(new Date())}
              timezone={timezone}
              dateColumn="alert_timestamp"
              onRowClick={handleAlertClick}
            />
          </Card>

          {/* Alert Details Drawer */}
          <AlertDetailsDrawer
            alert={selectedAlert}
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            timezone={timezone}
          />

        </main>
      </div>
    </div>
  )
}
