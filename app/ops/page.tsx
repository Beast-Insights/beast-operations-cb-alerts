'use client'

import { Card } from '@/components/Card'
import { Divider } from '@/components/Divider'
import { AreaChart } from '@/components/AreaChart'
import { BarChart } from '@/components/BarChart'
import { ProgressBar } from '@/components/ProgressBar'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/Table'
import { Badge } from '@/components/Badge'
import { ProgressCircle } from '@/components/ProgressCircle'
import {
  RiShareLine,
  RiSunLine,
  RiMoonLine,
  RiAlertLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiRefreshLine,
  RiTimeLine,
  RiErrorWarningLine,
  RiCheckboxCircleLine,
  RiSignalWifiLine,
  RiDatabase2Line
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { useEffect, useState, useCallback } from 'react'

interface VolumeByType {
  type: string
  total: number
  lastHour: number
  last24h: number
  last7d: number
  lastAlertTime: string
  totalCost: number
}

interface PipelineStatus {
  type: string
  totalReceived: number
  validOrder: number
  invalidOrder: number
  missingOrder: number
  alreadyRefunded: number
  refundInitiated: number
  refundConfirmed: number
  acknowledged: number
  closed: number
  effective: number
  statusInvalid: number
  statusUnable: number
  statusAlreadyRefunded: number
  statusChargeback: number
}

interface SlaRisk {
  ethoca: {
    breached: number
    warning: number
    healthy: number
    creditAtRisk: number
  }
  cdrn: {
    breached: number
    warning: number
    healthy: number
    creditAtRisk: number
  }
}

interface AlertNeedingAttention {
  alertId: string
  type: string
  timestamp: string
  ageHours: number
  hoursRemaining: number | null
  descriptor: string
  amount: number
  cost: number
  status: string
  isOrderValid: boolean | null
  isRefundInit: boolean | null
  isRefundCrm: boolean | null
  isAcknowledged: boolean | null
  isClosed: boolean | null
}

interface Effectiveness {
  type: string
  total: number
  effective: number
  rate: number
}

interface ProcessingTime {
  type: string
  avgHoursToRefundInit: number | null
  avgHoursRefundToCrm: number | null
  avgProcessingTime: number | null
}

interface VolumeTrend {
  time: string
  Ethoca: number
  CDRN: number
  RDR: number
  Ethoca_Processed: number
  CDRN_Processed: number
  RDR_Processed: number
}

interface OpsData {
  timestamp: string
  timeRange: string
  systemHealth: {
    overall: 'healthy' | 'warning' | 'critical'
    sla: 'healthy' | 'warning' | 'critical'
    processing: 'healthy' | 'warning' | 'critical'
    ingestion: 'healthy' | 'warning' | 'critical' | 'placeholder'
  }
  volumeTrend: VolumeTrend[]
  volumeByType: VolumeByType[]
  pipelineStatus: PipelineStatus[]
  slaRisk: SlaRisk
  alertsNeedingAttention: AlertNeedingAttention[]
  effectiveness: Effectiveness[]
  processingTimes: ProcessingTime[]
}

export default function OperationsDashboard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<OpsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('24h')
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    setMounted(true)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/ops?range=${timeRange}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed to fetch data')
      const result = await response.json()
      setData(result)
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [timeRange])

  // Initial load
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchData])

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'emerald'
      case 'warning': return 'yellow'
      case 'critical': return 'red'
      default: return 'gray'
    }
  }

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <RiCheckboxCircleLine className="size-5 text-emerald-500" />
      case 'warning': return <RiErrorWarningLine className="size-5 text-yellow-500" />
      case 'critical': return <RiAlertLine className="size-5 text-red-500" />
      default: return <RiLoader4Line className="size-5 text-gray-400" />
    }
  }

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date()
    const then = new Date(timestamp)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  if (!mounted) return null

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
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Navigation */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 pt-3">
          <div className="flex items-center gap-2">
            <RiDatabase2Line className="size-6 text-blue-500" />
            <span className="text-base font-semibold text-gray-900 dark:text-gray-50">Operations Center</span>
          </div>
          <div className="flex h-[42px] flex-nowrap items-center gap-2">
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded ${autoRefresh ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}
            >
              <span className={`size-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
              Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={toggleTheme}
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400"
            >
              {theme === 'dark' ? <RiSunLine className="size-5" /> : <RiMoonLine className="size-5" />}
            </button>
          </div>
        </div>
        <TabNavigation className="mt-3">
          <div className="mx-auto flex w-full max-w-7xl items-center px-6">
            <TabNavigationLink href="/">Support</TabNavigationLink>
            <TabNavigationLink href="#">Retention</TabNavigationLink>
            <TabNavigationLink href="/workflow">Workflow</TabNavigationLink>
            <TabNavigationLink href="/ops" active={true}>Operations</TabNavigationLink>
          </div>
        </TabNavigation>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Header with controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">Operations Monitoring</h1>
            <p className="text-sm text-gray-500">Real-time alert processing status • Timezone: EST</p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-500">
                Updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            {/* Time Range Selector */}
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              {(['24h', '7d', '30d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    timeRange === range
                      ? 'bg-blue-500 text-white'
                      : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              <RiRefreshLine className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* System Health Banner */}
        <Card className={`mb-6 ${data.systemHealth.overall === 'critical' ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20' : data.systemHealth.overall === 'warning' ? 'border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/20' : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20'}`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              {getHealthIcon(data.systemHealth.overall)}
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
                  System Status: {data.systemHealth.overall.toUpperCase()}
                </p>
                <p className="text-xs text-gray-500">
                  {data.systemHealth.overall === 'critical' && 'SLA breaches detected - Immediate action required'}
                  {data.systemHealth.overall === 'warning' && 'Some alerts approaching SLA deadline'}
                  {data.systemHealth.overall === 'healthy' && 'All systems operating normally'}
                </p>
              </div>
            </div>
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <RiTimeLine className="size-4 text-gray-400" />
                <span className="text-xs text-gray-600 dark:text-gray-400">SLA:</span>
                <Badge color={getHealthColor(data.systemHealth.sla)}>{data.systemHealth.sla}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <RiSignalWifiLine className="size-4 text-gray-400" />
                <span className="text-xs text-gray-600 dark:text-gray-400">Ingestion:</span>
                <Badge color="gray">N8n (Placeholder)</Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* Volume Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {data.volumeByType.map((vol) => (
            <Card key={vol.type}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{vol.type}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-50 mt-1">{vol.last24h}</p>
                  <p className="text-xs text-gray-500">Last 24h</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">{vol.lastHour}</p>
                  <p className="text-xs text-gray-500">Last hour</p>
                  <p className="text-xs text-gray-400 mt-2">Last: {formatTimeAgo(vol.lastAlertTime)}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* SLA Risk Monitor */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">SLA Risk Monitor</h3>
              <p className="text-sm text-gray-500">Ethoca: 24h window • CDRN: 72h window</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Ethoca SLA */}
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <p className="font-medium text-gray-900 dark:text-gray-50">Ethoca (24h SLA)</p>
                {data.slaRisk.ethoca.breached > 0 && (
                  <Badge color="red">{data.slaRisk.ethoca.breached} Breached</Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 rounded bg-red-50 dark:bg-red-950/30">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{data.slaRisk.ethoca.breached}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">Breached</p>
                  <p className="text-xs text-red-500 mt-1">${data.slaRisk.ethoca.creditAtRisk.toFixed(2)} at risk</p>
                </div>
                <div className="text-center p-3 rounded bg-yellow-50 dark:bg-yellow-950/30">
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{data.slaRisk.ethoca.warning}</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Warning</p>
                  <p className="text-xs text-yellow-500 mt-1">12-24h remaining</p>
                </div>
                <div className="text-center p-3 rounded bg-emerald-50 dark:bg-emerald-950/30">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.slaRisk.ethoca.healthy}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">Healthy</p>
                  <p className="text-xs text-emerald-500 mt-1">&lt;12h elapsed</p>
                </div>
              </div>
            </div>

            {/* CDRN SLA */}
            <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <p className="font-medium text-gray-900 dark:text-gray-50">CDRN (72h SLA)</p>
                {data.slaRisk.cdrn.breached > 0 && (
                  <Badge color="red">{data.slaRisk.cdrn.breached} Breached</Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 rounded bg-red-50 dark:bg-red-950/30">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{data.slaRisk.cdrn.breached}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">Breached</p>
                  <p className="text-xs text-red-500 mt-1">${data.slaRisk.cdrn.creditAtRisk.toFixed(2)} at risk</p>
                </div>
                <div className="text-center p-3 rounded bg-yellow-50 dark:bg-yellow-950/30">
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{data.slaRisk.cdrn.warning}</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Warning</p>
                  <p className="text-xs text-yellow-500 mt-1">36-72h remaining</p>
                </div>
                <div className="text-center p-3 rounded bg-emerald-50 dark:bg-emerald-950/30">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{data.slaRisk.cdrn.healthy}</p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">Healthy</p>
                  <p className="text-xs text-emerald-500 mt-1">&lt;36h elapsed</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Volume Trends Chart */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Alert Volume Trends</h3>
              <p className="text-sm text-gray-500">Received alerts by type ({timeRange === '24h' ? 'Hourly' : 'Daily'})</p>
            </div>
          </div>
          <AreaChart
            data={data.volumeTrend}
            index="time"
            categories={['Ethoca', 'CDRN', 'RDR']}
            colors={['blue', 'violet', 'amber']}
            className="h-64"
            showLegend={true}
            showGridLines={true}
          />
        </Card>

        {/* Processing Pipeline Status */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Processing Pipeline Status</h3>
              <p className="text-sm text-gray-500">Last 7 days - Stage-by-stage breakdown</p>
            </div>
          </div>

          <div className="space-y-6">
            {data.pipelineStatus.map((pipeline) => (
              <div key={pipeline.type} className="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <p className="font-medium text-gray-900 dark:text-gray-50">{pipeline.type}</p>
                    <Badge color="gray">{pipeline.totalReceived} total</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Effectiveness:</span>
                    <Badge color={pipeline.effective / pipeline.totalReceived >= 0.7 ? 'green' : pipeline.effective / pipeline.totalReceived >= 0.5 ? 'yellow' : 'red'}>
                      {Math.round((pipeline.effective / pipeline.totalReceived) * 100)}%
                    </Badge>
                  </div>
                </div>

                {/* Pipeline visualization */}
                <div className="grid grid-cols-5 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/30">
                    <p className="font-bold text-blue-700 dark:text-blue-300">{pipeline.totalReceived}</p>
                    <p className="text-blue-600 dark:text-blue-400">Received</p>
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-900">
                    <p className="font-bold text-gray-700 dark:text-gray-300">{pipeline.validOrder}</p>
                    <p className="text-gray-600 dark:text-gray-400">Valid Order</p>
                    <p className="text-red-500 text-[10px]">{pipeline.invalidOrder + pipeline.missingOrder} invalid/missing</p>
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-900">
                    <p className="font-bold text-gray-700 dark:text-gray-300">{pipeline.refundInitiated}</p>
                    <p className="text-gray-600 dark:text-gray-400">Refund Init</p>
                  </div>
                  <div className="p-2 rounded bg-gray-50 dark:bg-gray-900">
                    <p className="font-bold text-gray-700 dark:text-gray-300">{pipeline.refundConfirmed}</p>
                    <p className="text-gray-600 dark:text-gray-400">CRM Confirm</p>
                  </div>
                  {pipeline.type === 'Ethoca' ? (
                    <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/30">
                      <p className="font-bold text-emerald-700 dark:text-emerald-300">{pipeline.acknowledged}</p>
                      <p className="text-emerald-600 dark:text-emerald-400">Acknowledged</p>
                    </div>
                  ) : (
                    <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/30">
                      <p className="font-bold text-emerald-700 dark:text-emerald-300">{pipeline.effective}</p>
                      <p className="text-emerald-600 dark:text-emerald-400">Effective</p>
                    </div>
                  )}
                </div>

                {/* Status breakdown */}
                <div className="mt-3 flex gap-4 text-xs">
                  <span className="text-emerald-600">Effective: {pipeline.effective}</span>
                  <span className="text-gray-500">Invalid: {pipeline.statusInvalid}</span>
                  <span className="text-amber-600">Already Refunded: {pipeline.statusAlreadyRefunded}</span>
                  <span className="text-gray-500">Unable: {pipeline.statusUnable}</span>
                  <span className="text-red-600">Chargeback: {pipeline.statusChargeback}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Alerts Needing Attention */}
        {data.alertsNeedingAttention.length > 0 && (
          <Card className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Alerts Needing Attention</h3>
                <p className="text-sm text-gray-500">SLA at risk or breached - sorted by urgency</p>
              </div>
              <Badge color="red">{data.alertsNeedingAttention.length} alerts</Badge>
            </div>

            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Alert ID</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Age</TableHeaderCell>
                  <TableHeaderCell>Time Left</TableHeaderCell>
                  <TableHeaderCell>Descriptor</TableHeaderCell>
                  <TableHeaderCell>Cost</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.alertsNeedingAttention.slice(0, 20).map((alert) => (
                  <TableRow key={alert.alertId}>
                    <TableCell className="font-mono text-xs">{alert.alertId.slice(0, 12)}...</TableCell>
                    <TableCell>
                      <Badge color={alert.type === 'Ethoca' ? 'blue' : 'violet'}>{alert.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={alert.ageHours > (alert.type === 'Ethoca' ? 24 : 72) ? 'text-red-600 font-semibold' : ''}>
                        {alert.ageHours.toFixed(1)}h
                      </span>
                    </TableCell>
                    <TableCell>
                      {alert.hoursRemaining !== null ? (
                        <span className={alert.hoursRemaining < 0 ? 'text-red-600 font-semibold' : alert.hoursRemaining < 6 ? 'text-yellow-600' : 'text-emerald-600'}>
                          {alert.hoursRemaining < 0 ? 'BREACHED' : `${alert.hoursRemaining.toFixed(1)}h`}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">{alert.descriptor}</TableCell>
                    <TableCell>${alert.cost.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className={`size-2 rounded-full ${alert.isOrderValid ? 'bg-emerald-500' : alert.isOrderValid === false ? 'bg-red-500' : 'bg-gray-300'}`} title="Order Valid" />
                        <span className={`size-2 rounded-full ${alert.isRefundInit ? 'bg-emerald-500' : 'bg-gray-300'}`} title="Refund Init" />
                        <span className={`size-2 rounded-full ${alert.isRefundCrm ? 'bg-emerald-500' : 'bg-gray-300'}`} title="CRM Confirm" />
                        {alert.type === 'Ethoca' && (
                          <span className={`size-2 rounded-full ${alert.isAcknowledged ? 'bg-emerald-500' : 'bg-gray-300'}`} title="Acknowledged" />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Processing Times */}
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Processing Times</h3>
              <p className="text-sm text-gray-500">Average time at each stage (last 7 days)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.processingTimes.map((pt) => (
              <div key={pt.type} className="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-gray-50 mb-3">{pt.type}</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">To Refund Init:</span>
                    <span className="font-medium">{pt.avgHoursToRefundInit !== null ? `${pt.avgHoursToRefundInit}h` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">To CRM Confirm:</span>
                    <span className="font-medium">{pt.avgHoursRefundToCrm !== null ? `${pt.avgHoursRefundToCrm}h` : 'N/A'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* N8n Integration Placeholder */}
        <Card className="mb-6 opacity-60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Data Ingestion Monitor</h3>
              <p className="text-sm text-gray-500">N8n workflow status - Integration pending</p>
            </div>
            <Badge color="gray">Placeholder</Badge>
          </div>
          <div className="mt-4 p-4 rounded-lg bg-gray-100 dark:bg-gray-900 text-center">
            <RiDatabase2Line className="size-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">N8n event logs integration coming soon</p>
            <p className="text-xs text-gray-400 mt-1">Will show workflow run status, alert counts, and errors</p>
          </div>
        </Card>
      </div>
    </div>
  )
}
