'use client'

import { Badge } from '@/components/Badge'
import { cx } from '@/lib/utils'
import { formatSeconds } from '@/lib/recon/format'
import { phaseDescription } from '@/lib/recon/status'
import type { AgentStatus, Day7, DayStatus, RunError, RunStatus, Step } from '@/lib/recon/types'

const LABEL: Record<AgentStatus, string> = {
  healthy: 'Healthy', warning: 'Warning', error: 'Error', stale: 'Stale',
}
const VARIANT: Record<AgentStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  healthy: 'success', warning: 'warning', error: 'error', stale: 'neutral',
}

export function StatusBadge({ status }: { status: AgentStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}

const DOT: Record<DayStatus, string> = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  stale: 'bg-gray-400 dark:bg-gray-600',
  none: 'border border-dashed border-gray-200 dark:border-gray-700',
}

export function Sparkline7({ days, large = false }: { days: Day7[]; large?: boolean }) {
  const size = large ? 'size-4' : 'size-3.5'
  return (
    <span className="inline-flex items-center gap-1">
      {days.map((d, i) => (
        <span
          key={i}
          title={`${d.d} · ${d.n} run${d.n === 1 ? '' : 's'} · ${d.status === 'none' ? 'no run' : d.status}`}
          className={cx('block rounded-sm', size, DOT[d.status])}
        />
      ))}
    </span>
  )
}

const ICON: Record<string, string> = { SUCCESS: '✓', INFO: '✓', WARNING: '!', ERROR: '✕' }

export function ErrorBox({ error }: { error: RunError }) {
  const verb = error.fatal ? 'Failed at' : 'Issue at'
  return (
    <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      {error.error_type && (
        <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700 dark:bg-red-500/20 dark:text-red-300">
          {error.error_type}
        </span>
      )}
      {verb} <span className="font-semibold">{error.phase}</span> — {error.message}
    </div>
  )
}

export function Pipeline({ steps }: { steps: Step[] }) {
  return (
    <ul className="mt-1">
      {steps.map((s, i) => {
        const tone =
          s.level === 'ERROR' ? 'bg-red-100 text-red-600 dark:bg-red-500/15'
          : s.level === 'WARNING' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15'
          : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15'
        const showMsg = s.level === 'ERROR' || s.level === 'WARNING'
        const desc = phaseDescription(s.phase)
        return (
          <li key={i} className="flex items-start gap-3 border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800">
            <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold', tone)}>
              {ICON[s.level] ?? '•'}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx('text-sm font-medium',
                s.level === 'ERROR' ? 'text-red-700 dark:text-red-400'
                : s.level === 'WARNING' ? 'text-amber-700 dark:text-amber-400'
                : 'text-gray-900 dark:text-gray-100')}>
                {s.label}
              </span>
              {desc && (
                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-500">
                  {desc}
                </span>
              )}
              {showMsg && (
                <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                  {s.message}
                  {s.error_type && <em className="not-italic text-red-600 dark:text-red-400"> [{s.error_type}]</em>}
                </span>
              )}
            </span>
            {s.duration != null && (
              <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-600">
                {formatSeconds(s.duration)}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function statusOfRun(s: RunStatus): AgentStatus {
  return s
}
