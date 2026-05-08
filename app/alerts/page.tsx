'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { TabNavigation, TabNavigationLink } from '@/components/TabNavigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/Tabs'
import {
  RiArrowLeftLine,
  RiRefreshLine,
  RiLoader4Line,
  RiErrorWarningFill,
  RiAlertFill,
  RiInformationFill,
  RiCheckboxCircleFill,
  RiSunLine,
  RiMoonLine
} from '@remixicon/react'
import { useTheme } from 'next-themes'
import { NotificationsPanel } from '@/components/ui/operations-alerts'
import type { OperationsAlertsResponse, Alert } from '@/components/ui/operations-alerts'

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

// Format datetime
function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

// Format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

// Alert Row Component
function AlertRow({ alert }: { alert: Alert }) {
  const severityConfig = {
    critical: {
      icon: RiErrorWarningFill,
      iconColor: 'text-red-500',
      dotColor: 'bg-red-500'
    },
    warning: {
      icon: RiAlertFill,
      iconColor: 'text-amber-500',
      dotColor: 'bg-amber-500'
    },
    info: {
      icon: RiInformationFill,
      iconColor: 'text-blue-500',
      dotColor: 'bg-blue-500'
    }
  }

  const { icon: Icon, iconColor, dotColor } = severityConfig[alert.severity]

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="flex-shrink-0 pt-0.5">
        <div className={`h-2 w-2 rounded-full ${dotColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
          {alert.message}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {alert.details}
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <Badge
          variant={
            alert.severity === 'critical' ? 'error' :
            alert.severity === 'warning' ? 'warning' : 'default'
          }
          className="text-xs"
        >
          Active
        </Badge>
        <p className="text-xs text-gray-500 mt-1">
          {formatRelativeTime(alert.createdAt)}
        </p>
      </div>
    </div>
  )
}

export default function AlertsHistoryPage() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<OperationsAlertsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')

  useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/operations-alerts?timezone=IST', {
        cache: 'no-store'
      })
      if (!response.ok) throw new Error('Failed to fetch alerts')
      const result = await response.json()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  // Get all alerts combined
  const allAlerts = data ? [
    ...data.alerts.critical,
    ...data.alerts.warning,
    ...data.alerts.info
  ] : []

  // Filter based on active tab
  const filteredAlerts = activeTab === 'all'
    ? allAlerts
    : allAlerts.filter(a => a.severity === activeTab)

  // Group alerts by date
  const groupedAlerts = filteredAlerts.reduce((acc, alert) => {
    const dateKey = formatDate(alert.createdAt)
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(alert)
    return acc
  }, {} as Record<string, Alert[]>)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Navigation */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/processing"
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-400"
            >
              <RiArrowLeftLine className="size-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                Alerts History
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                View all active and historical alerts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAlerts}
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
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <RiLoader4Line className="size-8 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500">
            {error}
          </div>
        ) : (
          <Card className="p-0 overflow-hidden">
            {/* Tabs */}
            <div className="border-b border-gray-200 dark:border-gray-800 px-4">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="flex gap-4 -mb-px">
                  <TabsTrigger
                    value="all"
                    className="pb-3 text-sm font-medium text-gray-500 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600"
                  >
                    All ({allAlerts.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="critical"
                    className="pb-3 text-sm font-medium text-gray-500 border-b-2 border-transparent data-[state=active]:text-red-600 data-[state=active]:border-red-600"
                  >
                    Critical ({data?.alerts.critical.length || 0})
                  </TabsTrigger>
                  <TabsTrigger
                    value="warning"
                    className="pb-3 text-sm font-medium text-gray-500 border-b-2 border-transparent data-[state=active]:text-amber-600 data-[state=active]:border-amber-600"
                  >
                    Warning ({data?.alerts.warning.length || 0})
                  </TabsTrigger>
                  <TabsTrigger
                    value="info"
                    className="pb-3 text-sm font-medium text-gray-500 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600"
                  >
                    Info ({data?.alerts.info.length || 0})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Alerts List */}
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <RiCheckboxCircleFill className="size-12 text-emerald-500 mb-3" />
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-50">
                    No {activeTab === 'all' ? '' : activeTab} alerts
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    All systems are operating normally
                  </p>
                </div>
              ) : (
                Object.entries(groupedAlerts).map(([date, alerts]) => (
                  <div key={date}>
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900">
                      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {date}
                      </h3>
                    </div>
                    <div className="px-4">
                      {alerts.map((alert) => (
                        <AlertRow key={alert.id} alert={alert} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
