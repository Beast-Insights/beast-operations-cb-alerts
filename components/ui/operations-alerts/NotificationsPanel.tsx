'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  RiNotification3Line,
  RiLoader4Line,
  RiArrowRightLine,
  RiCheckLine,
  RiCheckboxCircleLine
} from '@remixicon/react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cx } from '@/lib/utils'
import type {
  OperationsAlertsResponse,
  Alert,
  DataSourceStatus
} from './types'

// Format duration
function formatDuration(minutes: number | null): string {
  if (minutes === null) return '-'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Format timestamp
function formatTimestamp(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

// Format date for alerts
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

// Compact Data Source Card
function DataSourceCard({ source }: { source: DataSourceStatus }) {
  const isHealthy = source.status === 'healthy'
  const isWarning = source.status === 'warning'
  const isCritical = source.status === 'critical'

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full flex-shrink-0',
            isHealthy && 'bg-emerald-500',
            isWarning && 'bg-amber-500',
            isCritical && 'bg-red-500'
          )}
        />
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {source.source}
        </span>
      </div>
      <p className={cx(
        'text-xs font-medium tabular-nums',
        isHealthy && 'text-gray-500 dark:text-gray-400',
        isWarning && 'text-amber-600 dark:text-amber-400',
        isCritical && 'text-red-600 dark:text-red-400'
      )}>
        {formatDuration(source.minutesAgo)}
      </p>
    </div>
  )
}

// Main Notifications Panel
export function NotificationsPanel() {
  const [data, setData] = useState<OperationsAlertsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'unread' | 'all'>('unread')
  const [readAlerts, setReadAlerts] = useState<Set<string>>(new Set())
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Load dismissed alerts
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dismissedOperationsAlerts')
      if (stored) {
        const parsed = JSON.parse(stored)
        const now = Date.now()
        const validAlerts = Object.entries(parsed)
          .filter(([_, timestamp]) => now - (timestamp as number) < 24 * 60 * 60 * 1000)
          .map(([id]) => id)
        setReadAlerts(new Set(validAlerts))
      }
    } catch {
      localStorage.removeItem('dismissedOperationsAlerts')
    }
  }, [])

  // Fetch alerts with optional silent refresh
  const fetchAlerts = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      else setIsRefreshing(true)

      const res = await fetch('/api/operations-alerts?timezone=IST', { cache: 'no-store' })
      if (res.ok) {
        setData(await res.json())
        setLastUpdated(new Date())
      }
    } catch (err) {
      console.error('Failed to fetch alerts:', err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Initial fetch and polling every 30 seconds
  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(() => fetchAlerts(true), 30000)
    return () => clearInterval(interval)
  }, [fetchAlerts])

  // Refresh when popover opens
  useEffect(() => {
    if (isOpen) {
      fetchAlerts(true)
    }
  }, [isOpen, fetchAlerts])

  // Refresh when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAlerts(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [fetchAlerts])

  // Dismiss alert
  const dismissAlert = useCallback((alertId: string) => {
    setReadAlerts(prev => {
      const next = new Set(prev)
      next.add(alertId)
      try {
        const stored = localStorage.getItem('dismissedOperationsAlerts')
        const existing = stored ? JSON.parse(stored) : {}
        existing[alertId] = Date.now()
        localStorage.setItem('dismissedOperationsAlerts', JSON.stringify(existing))
      } catch {}
      return next
    })
  }, [])

  // Dismiss all
  const dismissAllAlerts = useCallback(() => {
    if (!data) return
    const allIds = [...data.alerts.critical, ...data.alerts.warning, ...data.alerts.info].map(a => a.id)
    setReadAlerts(prev => {
      const next = new Set(Array.from(prev).concat(allIds))
      try {
        const stored = localStorage.getItem('dismissedOperationsAlerts')
        const existing = stored ? JSON.parse(stored) : {}
        const now = Date.now()
        allIds.forEach(id => { existing[id] = now })
        localStorage.setItem('dismissedOperationsAlerts', JSON.stringify(existing))
      } catch {}
      return next
    })
  }, [data])

  // Get alerts
  const allAlerts = data ? [...data.alerts.critical, ...data.alerts.warning, ...data.alerts.info] : []
  const unreadAlerts = allAlerts.filter(a => !readAlerts.has(a.id))
  const displayAlerts = activeTab === 'unread' ? unreadAlerts : allAlerts
  const unreadCount = unreadAlerts.length
  const hasCritical = data?.alerts.critical.some(a => !readAlerts.has(a.id))

  return (
    <PopoverPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          className="relative p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Notifications"
        >
          <RiNotification3Line className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className={cx(
              "absolute top-1 right-1 h-2 w-2 rounded-full",
              hasCritical ? "bg-red-500" : "bg-blue-500"
            )} />
          )}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className={cx(
            "w-[400px] rounded-lg border shadow-lg z-50",
            "border-gray-200 dark:border-gray-800",
            "bg-white dark:bg-gray-950",
            "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
          )}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Notifications
                </h2>
                {isRefreshing && (
                  <RiLoader4Line className="h-3 w-3 animate-spin text-gray-400" />
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={dismissAllAlerts}
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Mark {unreadCount} as read
                </button>
              )}
            </div>
            {lastUpdated && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            )}
          </div>

          {/* Data Source Status - Compact Horizontal Layout */}
          {data && (
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-4">
                <DataSourceCard source={data.dataSourceStatus.rdr} />
                <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />
                <DataSourceCard source={data.dataSourceStatus.ethoca} />
                <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />
                <DataSourceCard source={data.dataSourceStatus.cdrn} />
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-800">
            <div className="flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
              <button
                onClick={() => setActiveTab('unread')}
                className={cx(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  activeTab === 'unread'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                )}
              >
                Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={cx(
                  'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  activeTab === 'all'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                )}
              >
                All
              </button>
            </div>
          </div>

          {/* Alerts List */}
          <div className="max-h-[280px] overflow-y-auto">
            {loading && !data ? (
              <div className="flex items-center justify-center py-12">
                <RiLoader4Line className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : displayAlerts.length === 0 ? (
              <div className="py-12 text-center">
                <RiCheckboxCircleLine className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-900 dark:text-white">All caught up</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {activeTab === 'unread' ? 'No unread notifications' : 'No notifications'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {displayAlerts.map(alert => {
                  const isRead = readAlerts.has(alert.id)
                  return (
                    <div
                      key={alert.id}
                      className={cx('px-4 py-3', !isRead && 'bg-blue-50/50 dark:bg-blue-900/10')}
                    >
                      <div className="flex gap-3">
                        <div className="pt-1 flex-shrink-0">
                          <span
                            className={cx(
                              'block h-2 w-2 rounded-full',
                              alert.severity === 'critical' && 'bg-red-500',
                              alert.severity === 'warning' && 'bg-amber-500',
                              alert.severity === 'info' && 'bg-blue-500',
                              isRead && 'opacity-30'
                            )}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cx(
                            'text-sm leading-snug',
                            isRead ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'
                          )}>
                            {alert.message}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                            {formatDate(alert.createdAt)}
                          </p>
                        </div>
                        {!isRead && (
                          <button
                            onClick={() => dismissAlert(alert.id)}
                            className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                            title="Dismiss"
                          >
                            <RiCheckLine className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-800">
            <Link
              href="/alerts"
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors rounded-b-lg"
            >
              View all alerts
              <RiArrowRightLine className="h-3.5 w-3.5" />
            </Link>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
