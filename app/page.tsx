'use client'

import { Card } from '@/components/Card'
import { CategoryBar } from '@/components/CategoryBar'
import { Divider } from '@/components/Divider'
import { AreaChart } from '@/components/AreaChart'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/Table'
import { ProgressCircle } from '@/components/ProgressCircle'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'
import { RiAddLine, RiShareLine, RiSunLine, RiMoonLine, RiArrowUpSLine, RiArrowDownSLine, RiSearchLine, RiLoader4Line, RiRefreshLine } from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { formatDateLocal } from '@/lib/utils'
import { NotificationsPanel } from '@/components/ui/operations-alerts'

// Types
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

interface TrendDataPoint {
  time: string
  Today?: number
  Yesterday?: number
}

interface AlertAnalysisRow {
  dimension: string
  alerts: number
  amount: number
  rdr: number
  rdrEffective: number
  ethoca: number
  ethocaEffective: number
  cdrn: number
  cdrnEffective: number
  cb: number
  refund: number
}

interface FilterOption {
  hasData: boolean
  count: number
}

interface DashboardData {
  dateRange: { start: string; end: string }
  alertsByType: AlertsByType
  alertsByOutcome: AlertsByOutcome
  trendData: TrendDataPoint[]
  todayTotal: number
  yesterdayTotal: number
  alertAnalysisData: AlertAnalysisRow[]
  groupBy: string
  filterOptions: Record<string, FilterOption>
}

// Group by options configuration
const groupByConfig = [
  { value: 'gateway', label: 'Gateway' },
  { value: 'acquirer', label: 'Acquirer' },
  { value: 'bin', label: 'BIN' },
  { value: 'bank', label: 'Bank' },
  { value: 'pricePoint', label: 'Price Point' },
  { value: 'alertStatus', label: 'Alert Status' },
]

// Format status labels
const formatStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    'effective': 'Effective',
    'invalid_order': 'Invalid Order',
    'alert_already_refunded': 'Already Refunded',
    'unable_to_refund': 'Unable to Refund',
    'alert_got_chargeback': 'Turned into CB',
  }
  return labels[status] || status
}

export default function Dashboard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [groupBy, setGroupBy] = useState<string>('bin')
  const [filterSearch, setFilterSearch] = useState<string>('')
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)

  // Date range state
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  // Data state
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Fetch data from API
  const fetchData = useCallback(async (dimension: string, range?: DateRange) => {
    try {
      setLoading(true)
      let url = `/api/alerts?groupBy=${dimension}`
      if (range?.from && range?.to) {
        url += `&startDate=${formatDateLocal(range.from)}&endDate=${formatDateLocal(range.to)}`
      }
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()

      // Use API response directly (API returns proper dashboard format when groupBy is provided)
      setData(result)
      setLastUpdated(new Date())
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load - fetch data and set date range from response
  useEffect(() => {
    if (!initialLoadDone) {
      fetchData(groupBy).then((result) => {
        if (result?.dateRange) {
          setDateRange({
            from: new Date(result.dateRange.start),
            to: new Date(result.dateRange.end)
          })
        }
        setInitialLoadDone(true)
      })
    }
  }, [fetchData, groupBy, initialLoadDone])

  // Handle date range or groupBy changes after initial load
  useEffect(() => {
    if (initialLoadDone && dateRange?.from && dateRange?.to) {
      fetchData(groupBy, dateRange)
    }
  }, [groupBy, dateRange, fetchData, initialLoadDone])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false)
        setFilterSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter group by options based on search
  const filteredGroupByOptions = useMemo(() => {
    const options = groupByConfig.map(opt => ({
      ...opt,
      hasData: data?.filterOptions?.[opt.value]?.hasData ?? false,
      count: data?.filterOptions?.[opt.value]?.count ?? 0,
    }))

    if (!filterSearch) return options
    return options.filter(opt =>
      opt.label.toLowerCase().includes(filterSearch.toLowerCase())
    )
  }, [filterSearch, data])

  // Get current group by label
  const currentGroupByLabel = groupByConfig.find(opt => opt.value === groupBy)?.label || 'BIN'

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  // Handle dimension change
  const handleDimensionChange = (dimension: string) => {
    setGroupBy(dimension)
    setIsFilterOpen(false)
    setFilterSearch('')
  }

  // Calculate derived values
  const typePercentages = data?.alertsByType ? {
    ethoca: data.alertsByType.total > 0 ? Math.round((data.alertsByType.ethoca / data.alertsByType.total) * 100) : 0,
    cdrn: data.alertsByType.total > 0 ? Math.round((data.alertsByType.cdrn / data.alertsByType.total) * 100) : 0,
    rdr: data.alertsByType.total > 0 ? Math.round((data.alertsByType.rdr / data.alertsByType.total) * 100) : 0,
  } : { ethoca: 0, cdrn: 0, rdr: 0 }

  const effectivenessRate = data?.alertsByOutcome?.total && data.alertsByOutcome.total > 0
    ? ((data.alertsByOutcome.effective / data.alertsByOutcome.total) * 100).toFixed(1)
    : '0.0'

  const outcomePercentages = data?.alertsByOutcome ? {
    effective: data.alertsByOutcome.total > 0 ? Math.round((data.alertsByOutcome.effective / data.alertsByOutcome.total) * 100) : 0,
    invalidOrder: data.alertsByOutcome.total > 0 ? Math.round((data.alertsByOutcome.invalidOrder / data.alertsByOutcome.total) * 100) : 0,
    alreadyRefunded: data.alertsByOutcome.total > 0 ? Math.round((data.alertsByOutcome.alreadyRefunded / data.alertsByOutcome.total) * 100) : 0,
    notRefunded: data.alertsByOutcome.total > 0 ? Math.round((data.alertsByOutcome.notRefunded / data.alertsByOutcome.total) * 100) : 0,
    turnedIntoCB: data.alertsByOutcome.total > 0 ? Math.round((data.alertsByOutcome.turnedIntoCB / data.alertsByOutcome.total) * 100) : 0,
  } : { effective: 0, invalidOrder: 0, alreadyRefunded: 0, notRefunded: 0, turnedIntoCB: 0 }

  const totalAlerts = data?.alertAnalysisData?.reduce((sum, row) => sum + row.alerts, 0) || 0

  // Get dimension column header
  const getDimensionHeader = () => {
    switch (groupBy) {
      case 'bank': return 'Bank'
      case 'alertStatus': return 'Alert Status'
      case 'gateway': return 'Gateway'
      case 'acquirer': return 'Acquirer'
      case 'pricePoint': return 'Price Point'
      default: return 'BIN'
    }
  }

  // Format dimension value for display
  const formatDimensionValue = (value: string) => {
    if (groupBy === 'alertStatus') {
      return formatStatusLabel(value)
    }
    return value
  }

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <div className="flex items-center gap-3 text-gray-500">
          <RiLoader4Line className="size-6 animate-spin" />
          <span>Loading dashboard data...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <div className="text-center text-red-500">
          <p>Failed to load dashboard data</p>
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
            <span className="text-base font-semibold text-gray-900 dark:text-gray-50">Overview</span>
          </div>
          <div className="flex h-[42px] flex-nowrap items-center gap-2">
            <button
              onClick={toggleTheme}
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400"
              aria-label="Toggle theme"
            >
              {mounted && (theme === 'dark' ? <RiSunLine className="size-5" /> : <RiMoonLine className="size-5" />)}
            </button>
            <NotificationsPanel />
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300">
              ES
            </div>
          </div>
        </div>
        <TabNavigation className="mt-5">
          <div className="mx-auto flex w-full max-w-7xl items-center px-6">
            <TabNavigationLink href="/workflow">
              Ingestion
            </TabNavigationLink>
            <TabNavigationLink href="/processing">
              Processing
            </TabNavigationLink>
          </div>
        </TabNavigation>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <main>
          {/* Page Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
                Support Dashboard
              </h1>
              <p className="text-gray-500 dark:text-gray-500 sm:text-sm/6">
                Real-time monitoring of support metrics with AI-powered insights
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Last Updated */}
              {lastUpdated && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              {/* Date Range Filter */}
              <div className="w-64">
                <DateRangePicker
                  value={dateRange}
                  onChange={setDateRange}
                  placeholder="Select date range"
                />
              </div>
              <button
                onClick={() => fetchData(groupBy, dateRange)}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-2 text-center text-sm font-medium text-gray-700 shadow-sm transition-all duration-100 ease-in-out hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                <RiRefreshLine className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent bg-blue-500 px-3 py-2 text-center text-sm font-medium text-white shadow-sm transition-all duration-100 ease-in-out hover:bg-blue-600 dark:bg-blue-500 dark:hover:bg-blue-600">
                Create Ticket
                <RiAddLine className="-mr-0.5 size-5 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </div>

          <Divider />

          {/* KPI Cards */}
          <dl className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">

            {/* Card 1 - Alerts by Type */}
            <Card>
              <dt className="text-sm font-medium text-gray-900 dark:text-gray-50">
                Alerts by Type
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-gray-50">
                {data?.alertsByType?.total ?? 0}
              </dd>
              <CategoryBar
                values={[data?.alertsByType?.ethoca ?? 0, data?.alertsByType?.cdrn ?? 0, data?.alertsByType?.rdr ?? 0]}
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
                    {data?.alertsByType?.ethoca ?? 0} ({typePercentages.ethoca}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-400 dark:bg-gray-600" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">CDRN</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {data?.alertsByType?.cdrn ?? 0} ({typePercentages.cdrn}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-rose-500" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">RDR</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {data?.alertsByType?.rdr ?? 0} ({typePercentages.rdr}%)
                  </span>
                </li>
              </ul>
            </Card>

            {/* Card 2 - Alerts by Outcome */}
            <Card>
              <dt className="text-sm font-medium text-gray-900 dark:text-gray-50">
                Alerts by Outcome
              </dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-gray-900 dark:text-gray-50">
                  {effectivenessRate}%
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">Effectiveness rate</span>
              </dd>
              <CategoryBar
                values={[
                  data?.alertsByOutcome?.effective ?? 0,
                  data?.alertsByOutcome?.invalidOrder ?? 0,
                  data?.alertsByOutcome?.alreadyRefunded ?? 0,
                  data?.alertsByOutcome?.notRefunded ?? 0,
                  data?.alertsByOutcome?.turnedIntoCB ?? 0,
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
                    {data?.alertsByOutcome?.effective ?? 0} ({outcomePercentages.effective}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-400 dark:bg-gray-600" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts with invalid order</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {data?.alertsByOutcome?.invalidOrder ?? 0} ({outcomePercentages.invalidOrder}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-300 dark:bg-gray-700" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts already refunded</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {data?.alertsByOutcome?.alreadyRefunded ?? 0} ({outcomePercentages.alreadyRefunded}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts not refunded in CRM</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {data?.alertsByOutcome?.notRefunded ?? 0} ({outcomePercentages.notRefunded}%)
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm bg-gray-100 dark:bg-gray-900" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Alerts turned into CB</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {data?.alertsByOutcome?.turnedIntoCB ?? 0} ({outcomePercentages.turnedIntoCB}%)
                  </span>
                </li>
              </ul>
            </Card>

            {/* Card 3 - Alert Volume Trends */}
            <Card>
              <dt className="text-sm font-medium text-gray-900 dark:text-gray-50">
                Alert Volume Trends
              </dt>
              {data?.trendData && data.trendData.length > 0 ? (
                <AreaChart
                  data={data.trendData}
                  index="time"
                  categories={['Today', 'Yesterday']}
                  colors={['blue', 'gray']}
                  className="mt-4 h-40"
                  showLegend={false}
                  showYAxis={false}
                  showGridLines={true}
                  startEndOnly={true}
                  connectNulls={true}
                  fill="solid"
                />
              ) : (
                <div className="mt-4 h-40 flex items-center justify-center text-gray-400">
                  No trend data available
                </div>
              )}
              <ul className="mt-4 space-y-3">
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-[3px] w-3.5 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Today</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">{data?.todayTotal ?? 0}</span>
                </li>
                <li className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-[3px] w-3.5 shrink-0 rounded-full bg-gray-400 dark:bg-gray-600" aria-hidden="true" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Yesterday</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">{data?.yesterdayTotal ?? 0}</span>
                </li>
              </ul>
            </Card>
          </dl>

          {/* Alert Analysis Table - Tremor Table 5 Pattern */}
          <Card className="mt-8">
            <div className="sm:flex sm:items-center sm:justify-between sm:space-x-10">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-50">
                  Alert Analysis
                </h3>
                <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-500">
                  Overview of all alerts grouped by {currentGroupByLabel.toLowerCase()} within your organization.
                </p>
              </div>
              <div className="relative" ref={filterRef}>
                <button
                  type="button"
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className="mt-4 inline-flex items-center gap-x-1.5 whitespace-nowrap rounded-md bg-blue-500 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 sm:mt-0"
                >
                  {currentGroupByLabel}
                  {isFilterOpen ? (
                    <RiArrowUpSLine className="-mr-0.5 size-5" aria-hidden="true" />
                  ) : (
                    <RiArrowDownSLine className="-mr-0.5 size-5" aria-hidden="true" />
                  )}
                </button>

                {isFilterOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-md border border-gray-200 bg-white shadow-lg ring-1 ring-black ring-opacity-5 dark:border-gray-800 dark:bg-gray-950">
                    <div className="border-b border-gray-200 p-3 dark:border-gray-800">
                      <div className="relative">
                        <RiSearchLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search..."
                          value={filterSearch}
                          onChange={(e) => setFilterSearch(e.target.value)}
                          className="w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                      {filteredGroupByOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => option.hasData && handleDimensionChange(option.value)}
                          disabled={!option.hasData}
                          className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${
                            groupBy === option.value
                              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                              : option.hasData
                              ? 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-900'
                              : 'cursor-not-allowed text-gray-400 dark:text-gray-600'
                          }`}
                        >
                          <span>{option.label}</span>
                          {!option.hasData && (
                            <span className="text-xs text-gray-400 dark:text-gray-600">no data</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="relative">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 dark:bg-gray-950/50">
                  <RiLoader4Line className="size-6 animate-spin text-blue-500" />
                </div>
              )}

              <Table className="mt-8">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>{getDimensionHeader()}</TableHeaderCell>
                    <TableHeaderCell># Alerts</TableHeaderCell>
                    <TableHeaderCell>$ Alert</TableHeaderCell>
                    <TableHeaderCell># RDR</TableHeaderCell>
                    <TableHeaderCell>RDR Eff</TableHeaderCell>
                    <TableHeaderCell># Ethoca</TableHeaderCell>
                    <TableHeaderCell>Ethoca Eff</TableHeaderCell>
                    <TableHeaderCell># CDRN</TableHeaderCell>
                    <TableHeaderCell>CDRN Eff</TableHeaderCell>
                    <TableHeaderCell className="text-right"># CB</TableHeaderCell>
                    <TableHeaderCell className="text-right"># Refund</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data?.alertAnalysisData ?? []).map((row, index) => {
                    const rdrEffPct = row.rdr > 0 ? Math.round((row.rdrEffective / row.rdr) * 100) : 0
                    const ethocaEffPct = row.ethoca > 0 ? Math.round((row.ethocaEffective / row.ethoca) * 100) : 0
                    const cdrnEffPct = row.cdrn > 0 ? Math.round((row.cdrnEffective / row.cdrn) * 100) : 0
                    return (
                      <TableRow key={`${row.dimension}-${index}`}>
                        <TableCell className="font-medium text-gray-900 dark:text-gray-50">
                          {formatDimensionValue(row.dimension)}
                        </TableCell>
                        <TableCell>{row.alerts}</TableCell>
                        <TableCell>
                          ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{row.rdr}</TableCell>
                        <TableCell>
                          {row.rdr > 0 ? (
                            <div className="flex items-center gap-x-2.5">
                              <ProgressCircle
                                value={rdrEffPct}
                                radius={8}
                                strokeWidth={3}
                                variant={rdrEffPct >= 75 ? 'success' : rdrEffPct >= 50 ? 'warning' : 'error'}
                              />
                              <span>{rdrEffPct}%</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600">-</span>
                          )}
                        </TableCell>
                        <TableCell>{row.ethoca}</TableCell>
                        <TableCell>
                          {row.ethoca > 0 ? (
                            <div className="flex items-center gap-x-2.5">
                              <ProgressCircle
                                value={ethocaEffPct}
                                radius={8}
                                strokeWidth={3}
                                variant={ethocaEffPct >= 75 ? 'success' : ethocaEffPct >= 50 ? 'warning' : 'error'}
                              />
                              <span>{ethocaEffPct}%</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600">-</span>
                          )}
                        </TableCell>
                        <TableCell>{row.cdrn}</TableCell>
                        <TableCell>
                          {row.cdrn > 0 ? (
                            <div className="flex items-center gap-x-2.5">
                              <ProgressCircle
                                value={cdrnEffPct}
                                radius={8}
                                strokeWidth={3}
                                variant={cdrnEffPct >= 75 ? 'success' : cdrnEffPct >= 50 ? 'warning' : 'error'}
                              />
                              <span>{cdrnEffPct}%</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{row.cb}</TableCell>
                        <TableCell className="text-right">{row.refund}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </main>
      </div>
    </div>
  )
}
