'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  RiAlertFill,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiErrorWarningFill,
  RiInformationFill,
  RiLoader4Line,
  RiRefreshLine,
  RiCheckLine,
} from '@remixicon/react'

import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { CategoryBar } from '@/components/CategoryBar'
import { ProgressCircle } from '@/components/ProgressCircle'
import { Callout } from '@/components/Callout'
import { Divider } from '@/components/Divider'
import { LineChart } from '@/components/LineChart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRoot,
} from '@/components/Table'

import type {
  OverviewResponse,
  ScrapersResponse,
  IssueItem,
  IssuesQueue,
  HealthByGroup,
  RunGridCell,
  RunGridDetailRow,
  E2eStatusRow,
  E2eStatus,
  PerClientDailyPoint,
} from '@/lib/cb/types'
import {
  formatIst,
  formatIstTime,
  formatIstDateShort,
  formatRelative,
  formatInt,
  formatCompact,
  formatSeconds,
} from '@/lib/cb/format'
import {
  E2E_STATUS_LABEL,
  E2E_STATUS_TONE,
  E2E_STATUS_SEVERITY,
} from '@/lib/cb/e2e'
import { truncateError } from '@/lib/cb/classify'
import {
  ACTION_LABEL,
  ACTION_HOWTO,
  ACTION_TONE,
  buildActionQueue,
  groupByLogin,
  loadInProgress,
  saveInProgress,
  loginGroupKey,
  type ActionCategory,
  type ActionGroup,
  type LoginGroup,
} from '@/lib/cb/reliability'
import { cx } from '@/lib/utils'

const POLL_MS = 60_000

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function CbHealthOverview() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [scrapers, setScrapers] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedIso, setLastFetchedIso] = useState<string | null>(null)
  const [inProgress, setInProgress] = useState<Set<string>>(new Set())

  const fetchAll = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const suffix = manual ? '?refresh=1' : ''
      // Fetch overview + scrapers in parallel. Scrapers feeds the action queue
      // (already used by /cb/reliability) — same endpoint, server-cached for 55s.
      const [ovRes, scRes] = await Promise.all([
        fetch(`/api/cb/overview${suffix}`, { cache: 'no-store' }),
        fetch(`/api/cb/scrapers${suffix}`, { cache: 'no-store' }),
      ])
      if (!ovRes.ok) {
        const body = await ovRes.json().catch(() => ({}))
        throw new Error(body.message || `overview HTTP ${ovRes.status}`)
      }
      if (!scRes.ok) {
        const body = await scRes.json().catch(() => ({}))
        throw new Error(body.message || `scrapers HTTP ${scRes.status}`)
      }
      const ov = (await ovRes.json()) as OverviewResponse
      const sc = (await scRes.json()) as ScrapersResponse
      setData(ov)
      setScrapers(sc)
      setLastFetchedIso(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    setInProgress(loadInProgress())
  }, [])

  useEffect(() => {
    void fetchAll(false)
    const id = setInterval(() => void fetchAll(false), POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  const toggleInProgress = useCallback((key: string) => {
    setInProgress((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveInProgress(next)
      return next
    })
  }, [])

  // Build the action queue from scrapers data — same logic the Reliability tab uses.
  const actionQueue = useMemo(
    () => (scrapers ? buildActionQueue(scrapers.rows) : []),
    [scrapers],
  )

  if (loading && !data) return <PageLoading />
  if (error && !data) return <PageError message={error} onRetry={() => void fetchAll(true)} />
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Refresh strip */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Last refreshed {formatRelative(lastFetchedIso)} • Auto-refresh every 60s
        </p>
        <button
          type="button"
          onClick={() => void fetchAll(true)}
          disabled={refreshing}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
            'border-gray-200 text-gray-700 hover:bg-gray-50',
            'dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900',
            refreshing && 'opacity-60',
          )}
        >
          <RiRefreshLine className={cx('size-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Banner — only when something needs immediate attention */}
      {data.banner && (
        <Callout
          title={data.banner.severity === 'critical' ? 'Action needed' : 'Heads up'}
          variant={data.banner.severity === 'critical' ? 'error' : 'warning'}
        >
          <div className="flex items-start justify-between gap-4">
            <span>{data.banner.text}</span>
            <Link
              href="/cb/reliability"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
            >
              View <RiArrowRightLine className="size-3.5" />
            </Link>
          </div>
        </Callout>
      )}

      {/* KPI strip — 4 cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiActiveScrapers data={data} />
        <KpiLastRun data={data} scrapers={scrapers} />
        <KpiCredentialHealth data={data} />
        <KpiHealthyByClient data={data} scrapers={scrapers} />
      </div>

      {/* 50/50 row — 30-day cron history (LEFT) + per-client healthy-runs trend (RIGHT) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RunGridCard cells={data.run_grid} detail={data.run_grid_detail} />
        <PerClientTrendCard points={data.per_client_daily} clientIds={data.kpis.clients.ids} />
      </div>

      {/* End-to-end status table — the centerpiece */}
      <E2eStatusTable rows={data.e2e_rows} />

      {/* Action queue — replaces the old 4-bucket "Issues to fix" block */}
      <ActionQueueCard
        groups={actionQueue}
        loadingScrapers={!scrapers && !error}
        inProgress={inProgress}
        onToggleInProgress={toggleInProgress}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Cards
// ---------------------------------------------------------------------------
function KpiActiveScrapers({ data }: { data: OverviewResponse }) {
  const { enabled, total, unmapped } = data.kpis.scrapers
  const clients = data.kpis.clients
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Active scrapers</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">
        {enabled}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
        across {clients.count} clients
        {unmapped > 0 && (
          <>
            {' • '}
            <span className="text-amber-600 dark:text-amber-400">{unmapped} unmapped</span>
          </>
        )}
      </p>
      <Link
        href="/cb/scrapers"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        View all scrapers <RiArrowRightLine className="size-3.5" />
      </Link>
    </Card>
  )
}

// Last cron run — counts at the GATEWAY level (each enabled mid_manager
// row), not the orchestrator-invocation level. Multi-gateway shared-login
// peers (e.g. cliq /22 + /27 share one login → one invocation but TWO
// gateways) inherit the run status of their primary, then each gateway is
// counted separately. So "X / Y healthy" means X of Y enabled gateways
// were healthy in the latest cron run.
//
// Source: scrapers API (one row per enabled mid_manager record), grouped
// by shared portal login via groupByLogin() — same logic the other KPI
// scorecards on this page use, so the four cards stay coherent.
//
// Falls back to the SQL-aggregated last_run from /overview if scrapers
// hasn't loaded yet (avoids a flash of empty/zero numbers).
// Last cron run — counts at the GATEWAY level (each enabled mid_manager
// row), not the orchestrator-invocation level. Multi-gateway shared-login
// peers (e.g. cliq /22 + /27 share one login → one invocation but TWO
// gateways) inherit the run status of their primary, then each gateway is
// counted separately. So "X / Y healthy" means X of Y enabled gateways
// were healthy in the latest cron run.
//
// Total denominator stays equal to the OTHER three KPI cards (every
// enabled gateway, including never-ran/unmapped ones) — surfacing those
// gaps as a separate "no run" bucket rather than hiding them. Without
// this, this card would silently disagree with the rest of the strip
// (e.g. 44 here vs 45 elsewhere when one gateway was never picked up).
//
// Source: scrapers API (one row per enabled mid_manager record), grouped
// by shared portal login via groupByLogin() — same logic the other KPI
// scorecards on this page use, so the four cards stay coherent.
//
// Falls back to the SQL-aggregated last_run from /overview if scrapers
// hasn't loaded yet (avoids a flash of empty/zero numbers).
function KpiLastRun({
  data,
  scrapers,
}: {
  data: OverviewResponse
  scrapers: ScrapersResponse | null
}) {
  type Tally = {
    success: number
    no_data: number
    failed: number
    not_run: number      // gateway never ran / not picked up by orchestrator
    total: number        // ← always equals enabled-gateway total (45)
  }

  const tally = useMemo<Tally>(() => {
    if (!scrapers) {
      // Pre-load fallback — invocation-level numbers from /overview's SQL.
      // Only used until scrapers.json arrives; the gateway-level tally
      // replaces it on the next render.
      const lr = data.kpis.last_run
      return {
        success: lr.success,
        no_data: lr.no_data,
        failed: lr.failed,
        not_run: 0,
        total: lr.distinct_scrapers,
      }
    }
    const groups = groupByLogin(scrapers.rows)
    let success = 0, no_data = 0, failed = 0, not_run = 0, total = 0
    for (const g of groups) {
      const n = g.members.length      // ← one count per gateway
      total += n
      switch (g.primary.last_status) {
        case 'success':  success += n; break
        case 'no_data':  no_data += n; break
        case 'failed':   failed  += n; break
        default:         not_run += n; break  // null = never ran / unmapped
      }
    }
    return { success, no_data, failed, not_run, total }
  }, [scrapers, data.kpis.last_run])

  const healthy = tally.success + tally.no_data
  const pct = tally.total > 0 ? Math.round((healthy / tally.total) * 100) : 0
  const ringColor: 'emerald' | 'amber' | 'red' =
    pct >= 90 ? 'emerald' : pct >= 70 ? 'amber' : 'red'
  const endedUtc = data.kpis.last_run.ended_utc

  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Last cron run</p>
      <div className="mt-1 flex items-center gap-3">
        <ProgressCircle value={pct} radius={26} strokeWidth={5} color={ringColor}>
          <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-50">
            {pct}%
          </span>
        </ProgressCircle>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-50">
            {healthy} / {tally.total} healthy
          </p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-500">
            {endedUtc ? formatRelative(endedUtc) : 'No run yet'}
            {endedUtc && ` • ${formatIstTime(endedUtc)}`}
          </p>
        </div>
      </div>
      <p className="mt-3 truncate text-xs text-gray-500 dark:text-gray-500">
        {formatInt(tally.success)} ✓ &nbsp;/&nbsp; {formatInt(tally.no_data)} ⚪ &nbsp;/&nbsp;{' '}
        <span className={tally.failed > 0 ? 'text-red-600 dark:text-red-400' : ''}>
          {formatInt(tally.failed)} ✗
        </span>
        {tally.not_run > 0 && (
          <>
            {' '}&nbsp;/&nbsp;{' '}
            <span
              className="text-amber-600 dark:text-amber-400"
              title="Gateways enabled in mid_manager but not picked up by the latest cron"
            >
              {formatInt(tally.not_run)} ∅ no run
            </span>
          </>
        )}
      </p>
      <Link
        href="/cb/runs"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        Run history <RiArrowRightLine className="size-3.5" />
      </Link>
    </Card>
  )
}

function KpiCredentialHealth({ data }: { data: OverviewResponse }) {
  const { valid, invalid, unchecked, total, last_checked_utc } = data.kpis.creds
  const safeTotal = Math.max(1, total)
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-500">Login credentials</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">
        {valid}
        <span className="text-base font-normal text-gray-400 dark:text-gray-600">
          {' '}/ {total} valid
        </span>
      </p>
      <CategoryBar
        className="mt-3"
        values={[
          (valid / safeTotal) * 100,
          (invalid / safeTotal) * 100,
          (unchecked / safeTotal) * 100,
        ]}
        colors={['emerald', 'red', 'gray']}
        showLabels={false}
      />
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
        {invalid > 0 && <span className="text-red-600 dark:text-red-400">{invalid} invalid </span>}
        {unchecked > 0 && <span>{unchecked} unchecked</span>}
        {last_checked_utc && <span> • last checked {formatRelative(last_checked_utc)}</span>}
      </p>
      <Link
        href="/cb/scrapers?cred=invalid"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        View invalid credentials <RiArrowRightLine className="size-3.5" />
      </Link>
    </Card>
  )
}

// Per-client healthy-GATEWAYS breakdown — replaces the prior "Production
// data" silent-failures card. Counts at the GATEWAY level (each enabled
// mid_manager row), not the orchestrator-invocation level. Multi-gateway
// peers (e.g. cliq/22+27 share one login → one invocation but TWO
// gateways) inherit the run status of their primary, then each gateway is
// counted separately. So "15/18" means 15 of this client's 18 enabled
// gateways were healthy in the latest run.
//
// Source: scrapers API (one row per enabled mid_manager record), grouped
// by shared portal login via groupByLogin() — same logic the Reliability
// tab uses.
function KpiHealthyByClient({
  data,
  scrapers,
}: {
  data: OverviewResponse
  scrapers: ScrapersResponse | null
}) {
  type Stats = {
    healthy: number   // gateways whose primary's last_status is success or no_data
    failed: number    // gateways whose primary's last_status is failed
    other: number     // gateways with no run signal yet (unmapped lender / never logged)
    total: number     // enabled gateways for this client
  }

  const rows = useMemo(() => {
    if (!scrapers) return []
    const groups = groupByLogin(scrapers.rows)
    const map = new Map<string, Stats>()
    for (const g of groups) {
      const s = map.get(g.client_id) ?? { healthy: 0, failed: 0, other: 0, total: 0 }
      const n = g.members.length    // ← this is the gateway count
      s.total += n
      const status = g.primary.last_status
      if (status === 'success' || status === 'no_data') s.healthy += n
      else if (status === 'failed') s.failed += n
      else s.other += n
      map.set(g.client_id, s)
    }
    return Array.from(map.entries())
      .map(([client_id, s]) => ({ client_id, ...s }))
      .sort((a, b) => {
        // Worst-first by % healthy; alphabetical tie-break for layout stability
        const ah = a.total > 0 ? a.healthy / a.total : 1
        const bh = b.total > 0 ? b.healthy / b.total : 1
        if (ah !== bh) return ah - bh
        return a.client_id.localeCompare(b.client_id)
      })
  }, [scrapers])

  const totalHealthy = rows.reduce((s, r) => s + r.healthy, 0)
  const totalGateways = rows.reduce((s, r) => s + r.total, 0)

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-500">
          Healthy gateways by client
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-600">latest run</p>
      </div>

      {/* Headline = aggregate gateways healthy across all clients */}
      <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">
        {totalHealthy}
        <span className="text-base font-normal text-gray-400 dark:text-gray-600">
          {' '}/ {totalGateways}
        </span>
      </p>

      {!scrapers ? (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">No clients enabled.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const safe = Math.max(1, r.total)
            const pct = Math.round((r.healthy / safe) * 100)
            const tone =
              pct >= 90 ? 'emerald'
              : pct >= 70 ? 'amber'
              : 'red'
            return (
              <li key={r.client_id}>
                <div className="flex items-center justify-between text-[11px]">
                  <Link
                    href={`/cb/scrapers?client=${encodeURIComponent(r.client_id)}`}
                    className="font-medium tabular-nums text-gray-700 hover:underline dark:text-gray-300"
                  >
                    {r.client_id}
                  </Link>
                  <span className="tabular-nums text-gray-500 dark:text-gray-500">
                    {r.healthy}/{r.total}
                    <span
                      className={cx(
                        'ml-1.5',
                        tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
                        : tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-600 dark:text-red-400',
                      )}
                    >
                      {pct}%
                    </span>
                  </span>
                </div>
                <CategoryBar
                  className="mt-0.5"
                  values={[
                    (r.healthy / safe) * 100,
                    (r.failed / safe) * 100,
                    (r.other / safe) * 100,
                  ]}
                  colors={['emerald', 'red', 'gray']}
                  showLabels={false}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// End-to-end status table — the centerpiece
// ---------------------------------------------------------------------------
function E2eStatusTable({ rows }: { rows: E2eStatusRow[] }) {
  type Filter = 'issues' | 'all'
  const [filter, setFilter] = useState<Filter>('issues')
  const [client, setClient] = useState<string>('all')
  const clients = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client_id))).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    let xs = [...rows]
    if (filter === 'issues') xs = xs.filter((r) => r.e2e_status !== 'healthy')
    if (client !== 'all') xs = xs.filter((r) => r.client_id === client)
    xs.sort((a, b) => {
      const sevDiff = E2E_STATUS_SEVERITY[b.e2e_status] - E2E_STATUS_SEVERITY[a.e2e_status]
      if (sevDiff !== 0) return sevDiff
      return a.client_id.localeCompare(b.client_id)
    })
    return xs
  }, [rows, filter, client])

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
            End-to-end status
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Cron · Login · Production data — every scraper at a glance
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill active={filter === 'issues'} onClick={() => setFilter('issues')}>
            Issues only ({rows.filter((r) => r.e2e_status !== 'healthy').length})
          </FilterPill>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({rows.length})
          </FilterPill>
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
          >
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <RiCheckboxCircleFill className="size-8 text-emerald-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
            All scrapers healthy end-to-end
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Cron runs are succeeding and production data is fresh.
          </p>
        </div>
      ) : (
        <TableRoot className="max-h-[520px] overflow-y-auto">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Client</TableHeaderCell>
                <TableHeaderCell>Scraper</TableHeaderCell>
                <TableHeaderCell>Last cron</TableHeaderCell>
                <TableHeaderCell>Login</TableHeaderCell>
                <TableHeaderCell>Latest CB date</TableHeaderCell>
                <TableHeaderCell className="text-right">Loaded 24h</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((r) => (
                <TableRow
                  key={`${r.client_id}|${r.processor}|${r.gateway_id}`}
                  className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/60"
                >
                  <TableCell>
                    <E2eBadge status={r.e2e_status} />
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{r.client_id}</TableCell>
                  <TableCell>
                    <Link
                      href={`/cb/scrapers?focus=${encodeURIComponent(`${r.client_id}|${r.processor ?? ''}|${r.gateway_id}`)}`}
                      className="text-gray-900 hover:underline dark:text-gray-50"
                    >
                      <span className="text-gray-500 dark:text-gray-500">{r.processor ?? r.lender_name ?? '—'} / </span>
                      <span className="tabular-nums">{r.gateway_id}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CronCell row={r} />
                  </TableCell>
                  <TableCell>
                    <CredCell value={r.credentials_status} />
                  </TableCell>
                  <TableCell>
                    <CbDateCell row={r} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {formatInt(r.rows_loaded_last_24h)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </Card>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'h-8 rounded-md border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
          : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900',
      )}
    >
      {children}
    </button>
  )
}

function E2eBadge({ status }: { status: E2eStatus }) {
  const tone = E2E_STATUS_TONE[status]
  const variant: 'success' | 'error' | 'warning' | 'neutral' =
    tone === 'emerald' ? 'success' : tone === 'red' ? 'error' : tone === 'orange' || tone === 'amber' ? 'warning' : 'neutral'
  return <Badge variant={variant}>{E2E_STATUS_LABEL[status]}</Badge>
}

function CronCell({ row }: { row: E2eStatusRow }) {
  if (!row.last_run_utc)
    return <span className="text-xs text-gray-500 dark:text-gray-500">Never ran</span>
  const tone =
    row.last_status === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : row.last_status === 'no_data'
      ? 'text-gray-500'
      : 'text-red-600 dark:text-red-400'
  return (
    <span className="block whitespace-nowrap text-xs">
      <span className={tone}>
        {row.last_status === 'success' ? '✓' : row.last_status === 'no_data' ? '⚪' : '✗'}
      </span>{' '}
      <span className="text-gray-500 dark:text-gray-500">{formatRelative(row.last_run_utc)}</span>
    </span>
  )
}

function CredCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-gray-500 dark:text-gray-500">—</span>
  if (value === 'Valid')
    return <span className="text-xs text-emerald-600 dark:text-emerald-400">Valid</span>
  if (value === 'Invalid')
    return <span className="text-xs text-red-600 dark:text-red-400">Invalid</span>
  return <span className="text-xs text-amber-600 dark:text-amber-400">{value}</span>
}

function CbDateCell({ row }: { row: E2eStatusRow }) {
  if (!row.last_chargeback_date) {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-500">
        {row.last_loaded_at_utc ? 'No CB rows yet' : 'No data'}
      </span>
    )
  }
  const age = row.prod_data_age_days
  const tone =
    age === null
      ? 'text-gray-500'
      : age <= 3
      ? 'text-emerald-600 dark:text-emerald-400'
      : age <= 7
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400'
  return (
    <span className="block whitespace-nowrap text-xs">
      <span className="tabular-nums text-gray-900 dark:text-gray-50">
        {row.last_chargeback_date}
      </span>{' '}
      {age !== null && (
        <span className={tone}>
          ({age === 0 ? 'today' : age === 1 ? '1d' : `${age}d`} ago)
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 30-day Run grid (compact card)
// ---------------------------------------------------------------------------
// Cron slots — the VM runs daily crons at 01:00, 09:00, 17:00 UTC. Each slot
// gets its own horizontal lane in the timeline so flaky cadences (e.g. "01:00
// is unreliable") jump out at a glance instead of being hidden in a column.
type CronSlot = '01' | '09' | '17' | 'other'
const SLOT_ORDER: CronSlot[] = ['01', '09', '17', 'other']
const SLOT_LABEL: Record<CronSlot, string> = {
  '01': '01:00 UTC',
  '09': '09:00 UTC',
  '17': '17:00 UTC',
  other: 'Other',
}
function slotForCell(c: RunGridCell): CronSlot {
  // Bucket a cron run by its UTC start hour. Cron triggers ~01/09/17 UTC
  // but the actual start jitters by a few minutes — use a wide ±3h window.
  const h = new Date(c.started_utc).getUTCHours()
  if (h >= 23 || h <= 4) return '01'      // wraps midnight
  if (h >= 7 && h <= 12) return '09'
  if (h >= 15 && h <= 20) return '17'
  return 'other'
}

function RunGridCard({
  cells,
  detail,
}: {
  cells: RunGridCell[]
  detail: RunGridDetailRow[]
}) {
  // ----- Filter state -----
  // 'all' is the default for every dimension. Selecting any value
  // re-aggregates the timeline cells from `detail` so each dot reflects
  // ONLY the scrapers matching the filter.
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [processorFilter, setProcessorFilter] = useState<string>('all')
  const [gatewayFilter, setGatewayFilter] = useState<string>('all')

  // ----- Filter dropdown options -----
  // Options are scoped by the OTHER active filters so users only ever see
  // valid combinations (a "Stripe" pick won't show gateways from MX).
  // Sources are derived from `detail` because that's the single source of
  // truth for what's actually run.
  const filterOptions = useMemo(() => {
    const matchClient = (r: RunGridDetailRow) => clientFilter === 'all' || r.client_id === clientFilter
    const matchProc = (r: RunGridDetailRow) => processorFilter === 'all' || r.processor === processorFilter
    const matchGw = (r: RunGridDetailRow) => gatewayFilter === 'all' || r.gateway_id === gatewayFilter
    const clients = new Set<string>()
    const processors = new Set<string>()
    const gateways = new Set<string>()
    for (const r of detail) {
      // Build each option list from rows matching the OTHER two filters.
      if (matchProc(r) && matchGw(r)) clients.add(r.client_id)
      if (matchClient(r) && matchGw(r) && r.processor) processors.add(r.processor)
      if (matchClient(r) && matchProc(r)) gateways.add(r.gateway_id)
    }
    const cmpStr = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
    return {
      clients: Array.from(clients).sort(cmpStr),
      processors: Array.from(processors).sort(cmpStr),
      gateways: Array.from(gateways).sort(cmpStr),
    }
  }, [detail, clientFilter, processorFilter, gatewayFilter])

  const isFiltered = clientFilter !== 'all' || processorFilter !== 'all' || gatewayFilter !== 'all'

  // ----- Re-aggregate cells when any filter is active -----
  // No filter: use the SQL-side `cells` directly (cheap path).
  // With filter: walk `detail`, count per batch, and rebuild the grid cells.
  const filteredCells: RunGridCell[] = useMemo(() => {
    if (!isFiltered) return cells
    type Acc = {
      batch_id: number
      started_utc: string
      ended_utc: string
      success: number
      no_data: number
      failed: number
      scrapers: number
    }
    const byBatch = new Map<number, Acc>()
    for (const r of detail) {
      if (clientFilter !== 'all' && r.client_id !== clientFilter) continue
      if (processorFilter !== 'all' && r.processor !== processorFilter) continue
      if (gatewayFilter !== 'all' && r.gateway_id !== gatewayFilter) continue
      let a = byBatch.get(r.batch_id)
      if (!a) {
        a = {
          batch_id: r.batch_id,
          started_utc: r.started_utc,
          ended_utc: r.ended_utc,
          success: 0,
          no_data: 0,
          failed: 0,
          scrapers: 0,
        }
        byBatch.set(r.batch_id, a)
      }
      a.scrapers += 1
      if (r.status === 'success') a.success += 1
      else if (r.status === 'no_data') a.no_data += 1
      else if (r.status === 'failed') a.failed += 1
    }
    return Array.from(byBatch.values()).sort(
      (x, y) => new Date(x.started_utc).getTime() - new Date(y.started_utc).getTime(),
    )
  }, [cells, detail, clientFilter, processorFilter, gatewayFilter, isFiltered])

  // Build a 30-day × 4-slot matrix. Days with no run for a slot get null
  // and render as an empty placeholder cell — so missed crons are visible
  // (a row of greys means that slot didn't fire).
  // When filters are active we use the universe of days/slots from the
  // UNFILTERED `cells` so the gridlines stay stable; filtered cells just
  // light up where they apply (others render as "No run" placeholders).
  const matrix = useMemo(() => {
    // 1) Bucket FILTERED cells by (IST date, cron slot). Within a slot+day,
    // keep the most recent run (rare, but multiple manual triggers happen).
    const byKey = new Map<string, RunGridCell>()
    for (const c of filteredCells) {
      const day = formatIstDateShort(c.ended_utc).split(' ').slice(0, 2).join(' ')
      const slot = slotForCell(c)
      const key = `${day}|${slot}`
      const prior = byKey.get(key)
      if (!prior || new Date(c.started_utc).getTime() > new Date(prior.started_utc).getTime()) {
        byKey.set(key, c)
      }
    }

    // 2) Collect all distinct days from the UNFILTERED cells so axis stays
    // stable across filter changes (keeps the eye anchored to dates).
    const allDays = Array.from(new Set(
      cells.map((c) => formatIstDateShort(c.ended_utc).split(' ').slice(0, 2).join(' ')),
    ))
      .map((d) => ({ d, t: new Date(cells.find((c) => formatIstDateShort(c.ended_utc).startsWith(d))?.ended_utc ?? 0).getTime() }))
      .sort((a, b) => a.t - b.t)
      .slice(-30)
      .map(({ d }) => d)

    // 3) Slot lanes from the UNFILTERED cells too — same reason.
    const slots = SLOT_ORDER.filter((s) =>
      s === 'other'
        ? cells.some((c) => slotForCell(c) === 'other')
        : true,
    )

    return { byKey, allDays, slots }
  }, [cells, filteredCells])

  // Aggregate counts for the legend (reflects the FILTERED view)
  const totals = useMemo(() => {
    let healthy = 0, partial = 0, broken = 0
    for (const c of Array.from(matrix.byKey.values())) {
      if (c.failed === 0) healthy++
      else if (c.failed <= 3) partial++
      else broken++
    }
    return { healthy, partial, broken, total: healthy + partial + broken }
  }, [matrix])

  // Badge with affected scraper count under the active filters. Uses the
  // most-recent batch's filtered scraper count so users see "filter is on
  // and matches X of Y scrapers in the latest run".
  const filterMatchSummary = useMemo(() => {
    if (!isFiltered) return null
    const latestFiltered = filteredCells[filteredCells.length - 1]
    const latestAll = cells[cells.length - 1]
    if (!latestFiltered || !latestAll) return null
    return { matched: latestFiltered.scrapers, total: latestAll.scrapers }
  }, [filteredCells, cells, isFiltered])

  const resetFilters = () => {
    setClientFilter('all')
    setProcessorFilter('all')
    setGatewayFilter('all')
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
        30-day cron history
      </h3>

      {/* Filters — Client / Processor / Gateway ID */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RunGridFilterSelect
          label="Client"
          value={clientFilter}
          onChange={setClientFilter}
          options={filterOptions.clients}
        />
        <RunGridFilterSelect
          label="Processor"
          value={processorFilter}
          onChange={setProcessorFilter}
          options={filterOptions.processors}
        />
        <RunGridFilterSelect
          label="Gateway"
          value={gatewayFilter}
          onChange={setGatewayFilter}
          options={filterOptions.gateways}
        />
      </div>
      {isFiltered && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-500">
          <span>
            {filterMatchSummary
              ? `Showing ${filterMatchSummary.matched} of ${filterMatchSummary.total} scrapers in latest run`
              : 'No scrapers match the current filters'}
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Reset filters
          </button>
        </div>
      )}

      {/* Timeline grid */}
      <div className="mt-4 overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: '3px 4px' }}>
          <tbody>
            {matrix.slots.map((slot) => (
              <tr key={slot}>
                <td className="pr-3 text-right align-middle text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                  {SLOT_LABEL[slot]}
                </td>
                {matrix.allDays.map((day) => {
                  const c = matrix.byKey.get(`${day}|${slot}`)
                  return (
                    <td key={`${slot}|${day}`} className="p-0 align-middle">
                      <RunCellDot cell={c} />
                    </td>
                  )
                })}
              </tr>
            ))}
            {/* Date axis */}
            <tr>
              <td />
              {matrix.allDays.map((day, i) => {
                // Only label every 5th day to avoid clutter
                const showLabel = i === 0 || i === matrix.allDays.length - 1 || i % 5 === 0
                return (
                  <td key={`label|${day}`} className="px-0 pt-1 text-center align-top">
                    {showLabel && (
                      <span className="block whitespace-nowrap text-[9px] tabular-nums text-gray-500 dark:text-gray-500">
                        {day.split(' ')[0]}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Legend + totals */}
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3 text-[11px] text-gray-600 dark:border-gray-800 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-2.5 rounded-sm bg-emerald-500" /> Healthy
          <span className="ml-0.5 tabular-nums text-gray-500 dark:text-gray-500">({totals.healthy})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-2.5 rounded-sm bg-amber-500" /> 1–3 failed
          <span className="ml-0.5 tabular-nums text-gray-500 dark:text-gray-500">({totals.partial})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-2.5 rounded-sm bg-red-500" /> 4+ failed
          <span className="ml-0.5 tabular-nums text-gray-500 dark:text-gray-500">({totals.broken})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="block size-2.5 rounded-sm border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900" /> No run
        </span>
        <Link
          href="/cb/runs"
          className="ml-auto inline-flex items-center gap-1 font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Full run history <RiArrowRightLine className="size-3.5" />
        </Link>
      </div>
    </Card>
  )
}

// Tremor-styled labelled Select for the run-grid filter row.
// Uses the design-system Select (Radix-portal) so the dropdown overlay
// is never clipped by the Card's `p-4` / `overflow` and item rows have
// proper padding (no more text being chopped from the bottom).
function RunGridFilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  // When the active value is no longer in `options` (e.g. a sibling filter
  // pruned it out), surface it anyway so the UI keeps matching the state —
  // user can then switch to "All" or pick a still-valid option.
  const showOrphan = value !== 'all' && !options.includes(value)
  const isActive = value !== 'all'
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          className={cx(
            'h-9 text-xs tabular-nums',
            isActive &&
              'border-blue-400 ring-1 ring-blue-200 dark:border-blue-500/60 dark:ring-blue-500/20',
          )}
          aria-label={label}
        >
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {showOrphan && <SelectItem value={value}>{value}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function RunCellDot({ cell }: { cell?: RunGridCell }) {
  if (!cell) {
    // Missing cron run — no bar so the gap is visible without being noisy.
    return (
      <span
        className="block size-3.5 rounded-sm border border-dashed border-gray-200 dark:border-gray-700"
        title="No run"
        aria-label="No run for this slot"
      />
    )
  }
  const color =
    cell.failed === 0
      ? 'bg-emerald-500 hover:bg-emerald-600'
      : cell.failed <= 3
      ? 'bg-amber-500 hover:bg-amber-600'
      : 'bg-red-500 hover:bg-red-600'
  const tooltip = `${formatIst(cell.ended_utc)} • ${cell.success}✓ / ${cell.no_data}⚪ / ${cell.failed}✗ • ${cell.scrapers} scrapers`
  return (
    <Link
      href={`/cb/runs?batch=${cell.batch_id}`}
      title={tooltip}
      className={cx('block size-3.5 rounded-sm transition-colors', color)}
      aria-label={tooltip}
    />
  )
}

// ---------------------------------------------------------------------------
// Per-client healthy-runs trend (line chart, last 30 days)
// ---------------------------------------------------------------------------
function PerClientTrendCard({
  points,
  clientIds,
}: {
  points: PerClientDailyPoint[]
  clientIds: string[]
}) {
  // Pivot rows into the wide format Tremor's LineChart expects.
  // Series labels are the raw client_ids (e.g. "10057") so the legend
  // stays compact. One series per client.
  const sortedClients = useMemo(() => Array.from(clientIds).sort(), [clientIds])
  const data = useMemo(() => {
    type Row = { date: string } & Record<string, string | number>
    const byDay = new Map<string, Row>()
    for (const p of points) {
      let row = byDay.get(p.day_ist)
      if (!row) {
        row = { date: p.day_ist } as Row
        // Initialise every client to 0 so a missing day still shows on the line
        for (const c of sortedClients) row[c] = 0
        byDay.set(p.day_ist, row)
      }
      row[p.client_id] = p.healthy
    }
    return Array.from(byDay.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    )
  }, [points, sortedClients])

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
        30-day healthy runs · per client
      </h3>
      {data.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-200 py-10 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-500">No history yet.</p>
        </div>
      ) : (
        <LineChart
          data={data}
          index="date"
          categories={sortedClients}
          colors={['blue', 'emerald', 'violet', 'amber', 'cyan', 'pink']}
          valueFormatter={(v) => formatInt(v)}
          showLegend
          showYAxis
          showGridLines
          className="mt-4 h-64"
        />
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Action queue — replaces the old Issues to fix block. Reuses the same
// grouping logic the Reliability tab uses, so behaviour is consistent
// across both surfaces.
// ---------------------------------------------------------------------------
function ActionQueueCard({
  groups,
  loadingScrapers,
  inProgress,
  onToggleInProgress,
}: {
  groups: ActionGroup[]
  loadingScrapers: boolean
  inProgress: Set<string>
  onToggleInProgress: (k: string) => void
}) {
  const totalGw = groups.reduce((s, g) => s + g.affectedGatewayCount, 0)
  const totalActions = groups.length

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
            Action queue
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            {loadingScrapers
              ? 'Loading…'
              : totalActions === 0
              ? 'No open actions — everything healthy.'
              : `${totalActions} action${totalActions === 1 ? '' : 's'} can recover ${totalGw} gateway${totalGw === 1 ? '' : 's'}`}
          </p>
        </div>
        <Link
          href="/cb/reliability"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Open Reliability <RiArrowRightLine className="size-3.5" />
        </Link>
      </div>

      {loadingScrapers ? (
        <div className="flex items-center justify-center py-10">
          <RiLoader4Line className="size-5 animate-spin text-gray-500" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <RiCheckboxCircleFill className="size-9 text-emerald-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-50">All clear</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Every scraper is succeeding and production data is fresh.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {groups.map((g) => (
            <li key={g.category}>
              <ActionGroupRow
                group={g}
                inProgress={inProgress}
                onToggle={onToggleInProgress}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ActionGroupRow({
  group,
  inProgress,
  onToggle,
}: {
  group: ActionGroup
  inProgress: Set<string>
  onToggle: (k: string) => void
}) {
  const tone = ACTION_TONE[group.category]
  const Icon =
    tone === 'red'
      ? RiErrorWarningFill
      : tone === 'orange' || tone === 'amber'
      ? RiAlertFill
      : RiInformationFill
  const iconColor =
    tone === 'red'
      ? 'text-red-500'
      : tone === 'orange'
      ? 'text-orange-500'
      : tone === 'amber'
      ? 'text-amber-500'
      : 'text-blue-500'
  const [expanded, setExpanded] = useState(tone === 'red')
  const visible = expanded ? group.affectedGroups : group.affectedGroups.slice(0, 3)

  return (
    <div className="px-5 py-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={cx('mt-0.5 size-5 shrink-0', iconColor)} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              {ACTION_LABEL[group.category]}{' '}
              <span className="font-normal text-gray-500 dark:text-gray-500">
                · affects {group.affectedGatewayCount} gateway{group.affectedGatewayCount === 1 ? '' : 's'} across {group.affectedClientIds.size} client{group.affectedClientIds.size === 1 ? '' : 's'}
              </span>
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {ACTION_HOWTO[group.category]}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-500">
          {expanded ? 'Hide' : group.affectedGroups.length > 3 ? `Show all ${group.affectedGroups.length}` : 'Show'}
        </span>
      </button>

      <ul className="mt-3 space-y-2">
        {visible.map((lg) => (
          <ActionLoginGroupRow
            key={loginGroupKey(lg)}
            lg={lg}
            inProgress={inProgress}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  )
}

function ActionLoginGroupRow({
  lg,
  inProgress,
  onToggle,
}: {
  lg: LoginGroup
  inProgress: Set<string>
  onToggle: (k: string) => void
}) {
  const key = loginGroupKey(lg)
  const isInProgress = inProgress.has(key)
  const proc = lg.processor ?? lg.lender_name ?? '—'

  return (
    <li
      className={cx(
        'flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
        isInProgress
          ? 'border-blue-200 bg-blue-50/50 dark:border-blue-500/30 dark:bg-blue-500/5'
          : 'border-gray-200 dark:border-gray-800',
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
            {lg.client_id}
          </span>
          <span className="text-gray-500 dark:text-gray-500">/ {proc}</span>
          {lg.members.length === 1 ? (
            <span className="tabular-nums text-gray-700 dark:text-gray-300">
              / {lg.primary.effective_gw}
            </span>
          ) : (
            <span className="text-gray-700 dark:text-gray-300">
              /{' '}
              <span className="tabular-nums">
                {lg.members.map((m) => m.effective_gw).join('+')}
              </span>{' '}
              <span className="text-gray-500 dark:text-gray-500">
                ({lg.members.length} peers)
              </span>
            </span>
          )}
          {lg.portal_username && (
            <span className="text-gray-400 dark:text-gray-600">
              · login {lg.portal_username}
            </span>
          )}
        </div>
        {lg.primary.last_error && (
          <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">
            {truncateError(lg.primary.last_error, 160)}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-500">
          {lg.primary.last_run_utc ? <>Last run {formatRelative(lg.primary.last_run_utc)}</> : 'Never logged'}
          {lg.primary.consecutive_failures > 1 && (
            <span className="ml-2 text-red-600 dark:text-red-400">
              · failing {lg.primary.consecutive_failures}× in a row
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={`/cb/scrapers?focus=${encodeURIComponent(`${lg.client_id}|${lg.processor ?? ''}|${lg.primary.effective_gw}`)}`}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
        >
          Details <RiArrowRightLine className="size-3.5" />
        </Link>
        <button
          type="button"
          onClick={() => onToggle(key)}
          className={cx(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
            isInProgress
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-300'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900',
          )}
        >
          {isInProgress ? (
            <>
              <RiCheckLine className="size-3.5" /> In progress
            </>
          ) : (
            'Mark in progress'
          )}
        </button>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------------
function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <RiLoader4Line className="size-6 animate-spin" />
        <span>Loading dashboard…</span>
      </div>
    </div>
  )
}

function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <div className="flex flex-col items-center gap-3 p-2 text-center">
        <RiCloseCircleFill className="size-8 text-red-500" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
          Failed to load dashboard
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
        >
          <RiRefreshLine className="size-3.5" /> Retry
        </button>
      </div>
    </Card>
  )
}
