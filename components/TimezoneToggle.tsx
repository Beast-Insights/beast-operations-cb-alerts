'use client'

import React, { useEffect, useState } from 'react'
import { cx } from '@/lib/utils'

export type Timezone = 'IST' | 'EST'

interface TimezoneToggleProps {
  value: Timezone
  onChange: (timezone: Timezone) => void
  className?: string
}

const STORAGE_KEY = 'dashboard-timezone'

export function useTimezone(): [Timezone, (tz: Timezone) => void, boolean] {
  const [timezone, setTimezoneState] = useState<Timezone>('IST')
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Timezone | null
    if (stored === 'IST' || stored === 'EST') {
      setTimezoneState(stored)
    }
    setIsLoaded(true)
  }, [])

  const setTimezone = (tz: Timezone) => {
    setTimezoneState(tz)
    localStorage.setItem(STORAGE_KEY, tz)
    // Dispatch event for other tabs/components to sync
    window.dispatchEvent(new CustomEvent('timezone-change', { detail: tz }))
  }

  useEffect(() => {
    const handleChange = (e: Event) => {
      const customEvent = e as CustomEvent<Timezone>
      setTimezoneState(customEvent.detail)
    }
    window.addEventListener('timezone-change', handleChange)
    return () => window.removeEventListener('timezone-change', handleChange)
  }, [])

  return [timezone, setTimezone, isLoaded]
}

export function TimezoneToggle({ value, onChange, className }: TimezoneToggleProps) {
  return (
    <div className={cx('inline-flex items-center rounded-md bg-gray-100 p-0.5 dark:bg-gray-800', className)}>
      <button
        type="button"
        onClick={() => onChange('IST')}
        className={cx(
          'px-2.5 py-1 text-xs font-medium rounded transition-all duration-150',
          value === 'IST'
            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
        )}
      >
        IST
      </button>
      <button
        type="button"
        onClick={() => onChange('EST')}
        className={cx(
          'px-2.5 py-1 text-xs font-medium rounded transition-all duration-150',
          value === 'EST'
            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-50'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
        )}
      >
        EST
      </button>
    </div>
  )
}
