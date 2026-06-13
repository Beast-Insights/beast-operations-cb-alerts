'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RiArrowRightLine, RiLoader4Line, RiCloseCircleFill, RiRefreshLine } from '@remixicon/react'

import { Card } from '@/components/Card'
import { Callout } from '@/components/Callout'
import { ProgressCircle } from '@/components/ProgressCircle'
import { CategoryBar } from '@/components/CategoryBar'
import { LineChart } from '@/components/LineChart'

import type { OverviewResponse, RunGridDay } from '@/lib/recon/types'
import { formatRelative, formatIstTime, formatInt } from '@/lib/recon/format'
import { cx } from '@/lib/utils'

const POLL_MS = 60_000

export default function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<string | null>(null)

  const fetchData = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(`/api/ops/overview${manual ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`)
      setData((await res.json()) as OverviewResponse)
      setLastFetched(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(false)
    const id = setInterval(() => void fetchData(false), POLL_MS)
    return () => clearInterval(id)
  }, [fetchData])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorState message={error} onRetry={() => void fetchData(true)} />
  if (!data) return null

  const k = data.kpis

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Last refreshed {formatRelative(lastFetched)} • Auto-refresh every 60s
        </p>
        <RefreshButton refreshing={refreshing} onClick={() => void fetchData(true)} />
      </div>

      {data.banner && (
        <Callout
          title={data.banner.severity === 'critical' ? 'Action needed' : 'Heads up'}
          variant={data.banner.severity === 'critical' ? 'error' : 'warning'}
        >
          <div className="flex items-start justify-between gap-4">
            <span>{data.banner.text}</span>
            <Link href="/ops/scrapers?status=error" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-2 hover:underline">
              View <RiArrowRightLine className="size-3.5" />
            </Link>
          </div>
        </Callout>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiActive data={data} />
        <KpiLastRun data={data} />
        <KpiAlerts data={data} />
        <KpiByClient data={data} />
      </div>

      {/* run grid + trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RunGridCard cells={data.run_grid} />
        <TrendCard data={data} />
      </div>

      {/* 7-day activity */}
      <WeekCard data={data} />
    </div>
  )
}

// --------------------------------------------------------------------------- KPIs
function KpiActive({ data }: { data: OverviewResponse }) {
  const k = data.kpis
  const issues = k.warning + k.error + k.stale
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Active scrapers</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">{k.total}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
        across {k.clients.length} client{k.clients.length === 1 ? '' : 's'}
        {issues > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{issues} with issues</span></>}
      </p>
      <Link href="/ops/scrapers" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
        View all scrapers <RiArrowRightLine className="size-3.5" />
      </Link>
    </Card>
  )
}

function KpiLastRun({ data }: { data: OverviewResponse }) {
  const k = data.kpis
  const pct = k.total > 0 ? Math.round((k.healthy / k.total) * 100) : 0
  const color: 'emerald' | 'amber' | 'red' = pct >= 90 ? 'emerald' : pct >= 70 ? 'amber' : 'red'
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Latest-run health</p>
      <div className="mt-1 flex items-center gap-3">
        <ProgressCircle value={pct} radius={26} strokeWidth={5} color={color}>
          <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-50">{pct}%</span>
        </ProgressCircle>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-50">{k.healthy} / {k.total} healthy</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-500">
            {data.last_run_utc ? `${formatRelative(data.last_run_utc)} · ${formatIstTime(data.last_run_utc)}` : 'No run yet'}
          </p>
        </div>
      </div>
      <p className="mt-3 truncate text-xs text-gray-500 dark:text-gray-500">
        <span className="text-emerald-600 dark:text-emerald-400">{k.healthy} ✓</span> &nbsp;/&nbsp;
        <span className="text-amber-600 dark:text-amber-400"> {k.warning} !</span> &nbsp;/&nbsp;
        <span className={k.error ? 'text-red-600 dark:text-red-400' : ''}> {k.error} ✕</span>
        {k.stale > 0 && <> &nbsp;/&nbsp; <span className="text-gray-500">{k.stale} ◴ stale</span></>}
      </p>
    </Card>
  )
}

function KpiAlerts({ data }: { data: OverviewResponse }) {
  const k = data.kpis
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Open alerts</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">{k.open_alerts}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
        across {k.gateways_with_alerts} gateway{k.gateways_with_alerts === 1 ? '' : 's'}
      </p>
      <p className="mt-3 text-xs text-gray-400 dark:text-gray-600">funds_held · reserve_release_overdue · high_processing_fee</p>
    </Card>
  )
}

function KpiByClient({ data }: { data: OverviewResponse }) {
  const totalHealthy = data.by_client.reduce((s, c) => s + c.healthy, 0)
  const total = data.by_client.reduce((s, c) => s + c.total, 0)
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Healthy gateways by client</p>
        <p className="text-[11px] text-gray-400 dark:text-gray-600">latest run</p>
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">
        {totalHealthy}<span className="text-base font-normal text-gray-400 dark:text-gray-600"> / {total}</span>
      </p>
      <ul className="mt-3 space-y-1.5">
        {data.by_client.map((c) => {
          const safe = Math.max(1, c.total)
          const pct = Math.round((c.healthy / safe) * 100)
          const tone = pct >= 90 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
          return (
            <li key={c.client_id}>
              <div className="flex items-center justify-between text-[11px]">
                <Link href={`/ops/scrapers?client=${encodeURIComponent(c.client_id)}`} className="font-medium tabular-nums text-gray-700 hover:underline dark:text-gray-300">
                  {c.client_id}
                </Link>
                <span className="tabular-nums text-gray-500 dark:text-gray-500">{c.healthy}/{c.total} <span className={cx('ml-1', tone)}>{pct}%</span></span>
              </div>
              <CategoryBar className="mt-0.5"
                values={[(c.healthy / safe) * 100, (c.warning / safe) * 100, (c.stale / safe) * 100, (c.error / safe) * 100]}
                colors={['emerald', 'amber', 'gray', 'red']} showLabels={false} />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// --------------------------------------------------------------------------- run grid
function RunGridCard({ cells }: { cells: RunGridDay[] }) {
  const totals = cells.reduce((acc, c) => {
    if (c.runs === 0) return acc
    if (c.error === 0) acc.healthy++
    else if (c.error <= 2) acc.partial++
    else acc.broken++
    return acc
  }, { healthy: 0, partial: 0, broken: 0 })

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">30-day run history</h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">Each cell is one day (IST), coloured by failed runs.</p>
      <div className="mt-4 overflow-x-auto">
        <div className="flex items-end gap-[3px]">
          {cells.map((c, i) => <RunCell key={i} cell={c} />)}
        </div>
        <div className="mt-1 flex gap-[3px]">
          {cells.map((c, i) => (
            <span key={i} className="w-3.5 shrink-0 text-center text-[8px] tabular-nums text-gray-400 dark:text-gray-600">
              {i === 0 || i === cells.length - 1 || i % 5 === 0 ? c.d.split(' ')[1] : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3 text-[11px] text-gray-600 dark:border-gray-800 dark:text-gray-400">
        <Legend color="bg-emerald-500" label="All healthy" n={totals.healthy} />
        <Legend color="bg-amber-500" label="1–2 failed" n={totals.partial} />
        <Legend color="bg-red-500" label="3+ failed" n={totals.broken} />
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-2.5 rounded-sm border border-dashed border-gray-300 dark:border-gray-700" /> No run
        </span>
      </div>
    </Card>
  )
}

function RunCell({ cell }: { cell: RunGridDay }) {
  if (cell.runs === 0) {
    return <span title={`${cell.d} · no run`} className="block size-3.5 shrink-0 rounded-sm border border-dashed border-gray-300 dark:border-gray-700" />
  }
  const color = cell.error === 0 ? 'bg-emerald-500' : cell.error <= 2 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <span
      title={`${cell.d} · ${cell.healthy}✓ / ${cell.warning}! / ${cell.error}✕ · ${cell.runs} runs`}
      className={cx('block size-3.5 shrink-0 rounded-sm', color)}
    />
  )
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('block size-2.5 rounded-sm', color)} /> {label}
      <span className="tabular-nums text-gray-500 dark:text-gray-500">({n})</span>
    </span>
  )
}

// --------------------------------------------------------------------------- trend
function TrendCard({ data }: { data: OverviewResponse }) {
  const clients = useMemo(() => [...data.kpis.clients].sort(), [data.kpis.clients])
  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, string | number>>()
    for (const p of data.per_client_daily) {
      let row = byDay.get(p.day)
      if (!row) { row = { date: p.day }; for (const c of clients) row[c] = 0; byDay.set(p.day, row) }
      row[p.client_id] = p.healthy
    }
    return Array.from(byDay.values())
  }, [data.per_client_daily, clients])

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">30-day healthy runs · per client</h3>
      {chartData.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 py-10 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-500">No history yet.</p>
        </div>
      ) : (
        <LineChart data={chartData} index="date" categories={clients}
          colors={['blue', 'emerald', 'violet', 'amber', 'cyan', 'pink']}
          valueFormatter={(v) => formatInt(v)} showLegend showYAxis showGridLines className="mt-4 h-64" />
      )}
    </Card>
  )
}

// --------------------------------------------------------------------------- 7-day activity
function WeekCard({ data }: { data: OverviewResponse }) {
  const max = Math.max(1, ...data.week.map((w) => w.healthy + w.warning + w.error + w.stale))
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Last 7 days · activity</h3>
        <span className="text-xs text-gray-400 dark:text-gray-600">worst status per gateway per day (IST)</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-3">
        {data.week.map((w, i) => {
          const active = w.healthy + w.warning + w.error + w.stale
          const seg = (n: number, color: string) => n
            ? <span key={color} style={{ height: `${(64 * n) / max}px` }} className={cx('block rounded-sm', color)} title={`${n}`} /> : null
          return (
            <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/50 p-2.5 text-center dark:border-gray-800 dark:bg-gray-900/40">
              <div className="text-[11px] text-gray-400 dark:text-gray-600">{w.d}</div>
              <div className="mt-2 flex h-16 flex-col-reverse justify-end gap-0.5">
                {seg(w.error, 'bg-red-500')}
                {seg(w.warning, 'bg-amber-500')}
                {seg(w.stale, 'bg-gray-400 dark:bg-gray-600')}
                {seg(w.healthy, 'bg-emerald-500')}
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">{active}/{data.kpis.total}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-gray-600 dark:text-gray-400">
        <Legend color="bg-emerald-500" label="Healthy" n={data.week.reduce((s, w) => s + w.healthy, 0)} />
        <Legend color="bg-amber-500" label="Warning" n={data.week.reduce((s, w) => s + w.warning, 0)} />
        <Legend color="bg-red-500" label="Error" n={data.week.reduce((s, w) => s + w.error, 0)} />
        <Legend color="bg-gray-400 dark:bg-gray-600" label="Stale" n={data.week.reduce((s, w) => s + w.stale, 0)} />
      </div>
    </Card>
  )
}

// --------------------------------------------------------------------------- chrome
function RefreshButton({ refreshing, onClick }: { refreshing: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={refreshing}
      className={cx('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
        'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900',
        refreshing && 'opacity-60')}>
      <RiRefreshLine className={cx('size-3.5', refreshing && 'animate-spin')} /> Refresh
    </button>
  )
}

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <RiLoader4Line className="size-6 animate-spin" /> <span>Loading dashboard…</span>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <div className="flex flex-col items-center gap-3 p-2 text-center">
        <RiCloseCircleFill className="size-8 text-red-500" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">Failed to load dashboard</p>
        <p className="text-xs text-gray-500 dark:text-gray-500">{message}</p>
        <button type="button" onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">
          <RiRefreshLine className="size-3.5" /> Retry
        </button>
      </div>
    </Card>
  )
}
