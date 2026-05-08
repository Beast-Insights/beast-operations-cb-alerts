'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiExternalLinkLine,
  RiLoader4Line,
  RiRefreshLine,
} from '@remixicon/react'

import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { Searchbar } from '@/components/Searchbar'
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
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/Drawer'

import type { ScraperRow, ScrapersResponse, ScraperStatus, E2eStatus } from '@/lib/cb/types'
import {
  formatIst,
  formatRelative,
  formatInt,
  formatSeconds,
} from '@/lib/cb/format'
import { classifyFailure, FAILURE_CATEGORY_LABEL, truncateError } from '@/lib/cb/classify'
import { E2E_STATUS_LABEL, E2E_STATUS_TONE, E2E_STATUS_SEVERITY } from '@/lib/cb/e2e'
import { cx } from '@/lib/utils'

const POLL_MS = 60_000
const PAGE_SIZE = 50

type GroupBy = 'none' | 'client' | 'processor'
type StatusFilter = 'all' | 'issues' | 'silent' | 'success' | 'failed' | 'no_data' | 'never'

// =============================================================================
// Page
// =============================================================================
export default function CbScrapersPage() {
  const [data, setData] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedIso, setLastFetchedIso] = useState<string | null>(null)

  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [client, setClient] = useState('all')
  const [processor, setProcessor] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [credFilter, setCredFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [drawerRow, setDrawerRow] = useState<ScraperRow | null>(null)

  const fetchScrapers = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(manual ? '/api/cb/scrapers?refresh=1' : '/api/cb/scrapers', {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as ScrapersResponse
      setData(json)
      setLastFetchedIso(new Date().toISOString())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // initial url params
  useEffect(() => {
    const u = new URL(window.location.href)
    const cl = u.searchParams.get('client')
    if (cl) setClient(cl)
    const pr = u.searchParams.get('lender') ?? u.searchParams.get('processor')
    if (pr) setProcessor(pr)
    const filter = u.searchParams.get('filter')
    if (filter === 'failing') setStatusFilter('failed')
    if (filter === 'issues') setStatusFilter('issues')
    if (filter === 'silent') setStatusFilter('silent')
    const cred = u.searchParams.get('cred')
    if (cred) setCredFilter(cred === 'invalid' ? 'Invalid' : cred)
    const focus = u.searchParams.get('focus')
    if (focus) {
      // Set search to the focus key so the row is easy to spot
      setSearch(focus.split('|').filter(Boolean).join(' '))
    }
  }, [])

  useEffect(() => {
    void fetchScrapers(false)
    const id = setInterval(() => void fetchScrapers(false), POLL_MS)
    return () => clearInterval(id)
  }, [fetchScrapers])

  // Filtered + sorted rows
  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    let xs = data.rows.filter((r) => {
      if (statusFilter === 'issues' && r.e2e_status === 'healthy') return false
      if (statusFilter === 'silent' && r.e2e_status !== 'silent_failure') return false
      if (statusFilter === 'failed' && r.last_status !== 'failed') return false
      if (statusFilter === 'success' && r.last_status !== 'success') return false
      if (statusFilter === 'no_data' && r.last_status !== 'no_data') return false
      if (statusFilter === 'never' && r.last_status !== null) return false
      if (client !== 'all' && r.client_id !== client) return false
      if (
        processor !== 'all' &&
        r.processor !== processor &&
        r.lender_name !== processor
      )
        return false
      if (credFilter !== 'all' && (r.credentials_status ?? '') !== credFilter) return false
      if (q) {
        const blob = [
          r.client_id,
          r.processor,
          r.lender_name,
          r.gateway_id,
          r.mid,
          r.portal_url,
          r.portal_username,
          r.effective_gw,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
    // Sort: severity desc, then client, then processor, then gateway
    xs.sort((a, b) => {
      const sev = E2E_STATUS_SEVERITY[b.e2e_status] - E2E_STATUS_SEVERITY[a.e2e_status]
      if (sev !== 0) return sev
      const c = a.client_id.localeCompare(b.client_id)
      if (c !== 0) return c
      const p = (a.processor ?? '').localeCompare(b.processor ?? '')
      if (p !== 0) return p
      return a.effective_gw.localeCompare(b.effective_gw)
    })
    return xs
  }, [data, statusFilter, client, processor, credFilter, search])

  // reset paging when filters change
  useEffect(() => {
    setPage(1)
  }, [statusFilter, client, processor, credFilter, search, groupBy])

  if (loading && !data) return <PageLoading />
  if (error && !data) return <PageError message={error} onRetry={() => void fetchScrapers(true)} />
  if (!data) return null

  const totals = {
    total: data.rows.length,
    healthy: data.rows.filter((r) => r.e2e_status === 'healthy').length,
    issues: data.rows.filter((r) => r.e2e_status !== 'healthy').length,
  }

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  return (
    <div className="space-y-5">
      {/* refresh strip */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {totals.total} scrapers • {totals.issues} with issues • Last refreshed{' '}
          {formatRelative(lastFetchedIso)} • Auto-refresh every 60s
        </p>
        <button
          type="button"
          onClick={() => void fetchScrapers(true)}
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

      {/* Filter bar */}
      <Card className="p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
          <Searchbar
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search gateway, MID, portal, username…"
            className="lg:col-span-2"
          />
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger>
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {data.filters.clients.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={processor} onValueChange={setProcessor}>
            <SelectTrigger>
              <SelectValue placeholder="Processor / lender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All processors / lenders</SelectItem>
              {Array.from(
                new Set([...data.filters.processors, ...data.filters.lenders]),
              )
                .sort()
                .map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="issues">Issues only</SelectItem>
              <SelectItem value="silent">Silent failures</SelectItem>
              <SelectItem value="failed">Last cron failed</SelectItem>
              <SelectItem value="success">Last cron success</SelectItem>
              <SelectItem value="no_data">Last cron no_data</SelectItem>
              <SelectItem value="never">Never ran</SelectItem>
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger>
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No grouping</SelectItem>
              <SelectItem value="client">Group by client</SelectItem>
              <SelectItem value="processor">Group by processor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">
          Showing {filtered.length} of {data.rows.length}
        </div>
      </Card>

      {/* Table view */}
      {groupBy === 'none' ? (
        <ScrapersTable
          rows={pageRows}
          page={page}
          pageCount={pageCount}
          setPage={setPage}
          onRowClick={setDrawerRow}
        />
      ) : (
        <GroupView
          rows={filtered}
          groupBy={groupBy}
          onScraperClick={setDrawerRow}
        />
      )}

      <ScraperDrawer row={drawerRow} onOpenChange={(open) => !open && setDrawerRow(null)} />
    </div>
  )
}

// =============================================================================
// Master table
// =============================================================================
function ScrapersTable({
  rows,
  page,
  pageCount,
  setPage,
  onRowClick,
}: {
  rows: ScraperRow[]
  page: number
  pageCount: number
  setPage: (p: number) => void
  onRowClick: (r: ScraperRow) => void
}) {
  if (rows.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-12">
        <RiCheckboxCircleFill className="size-8 text-emerald-500" />
        <p className="text-sm font-medium text-gray-900 dark:text-gray-50">No scrapers match</p>
        <p className="text-xs text-gray-500 dark:text-gray-500">Adjust filters above</p>
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden p-0">
      <TableRoot className="max-h-[640px] overflow-y-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Client</TableHeaderCell>
              <TableHeaderCell>Scraper</TableHeaderCell>
              <TableHeaderCell>Last cron</TableHeaderCell>
              <TableHeaderCell>Cred</TableHeaderCell>
              <TableHeaderCell>Latest CB date</TableHeaderCell>
              <TableHeaderCell className="text-right">Loaded 24h</TableHeaderCell>
              <TableHeaderCell className="text-right">7-day</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                onClick={() => onRowClick(r)}
                className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <TableCell>
                  <E2eBadge status={r.e2e_status} />
                </TableCell>
                <TableCell className="font-medium tabular-nums">{r.client_id}</TableCell>
                <TableCell>
                  <span className="text-gray-500 dark:text-gray-500">
                    {r.processor ?? r.lender_name ?? '—'} /{' '}
                  </span>
                  <span className="tabular-nums text-gray-900 dark:text-gray-50">
                    {r.effective_gw}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {r.last_run_utc ? (
                    <>
                      <span
                        className={
                          r.last_status === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : r.last_status === 'no_data'
                            ? 'text-gray-500'
                            : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {r.last_status === 'success'
                          ? '✓'
                          : r.last_status === 'no_data'
                          ? '⚪'
                          : '✗'}
                      </span>{' '}
                      <span className="text-gray-500 dark:text-gray-500">
                        {formatRelative(r.last_run_utc)}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-500">Never</span>
                  )}
                </TableCell>
                <TableCell>
                  <CredBadge value={r.credentials_status} />
                </TableCell>
                <TableCell>
                  <CbDateInline row={r} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-gray-600 dark:text-gray-400">
                  {formatInt(r.rows_loaded_last_24h)}
                </TableCell>
                <TableCell className="text-right">
                  <SparklineRow pattern={r.pattern_7d} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>

      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-xs dark:border-gray-800">
          <span className="text-gray-500 dark:text-gray-500">
            Page {page} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="rounded-md border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page === pageCount}
              onClick={() => setPage(page + 1)}
              className="rounded-md border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function CbDateInline({ row }: { row: ScraperRow }) {
  if (!row.last_chargeback_date) {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-500">
        {row.rows_total_in_prod === 0 ? 'No CB rows' : '—'}
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

// =============================================================================
// Group view (client / processor)
// =============================================================================
function GroupView({
  rows,
  groupBy,
  onScraperClick,
}: {
  rows: ScraperRow[]
  groupBy: 'client' | 'processor'
  onScraperClick: (r: ScraperRow) => void
}) {
  const groups = useMemo(() => {
    const m = new Map<string, ScraperRow[]>()
    for (const r of rows) {
      const k =
        groupBy === 'client'
          ? r.client_id
          : r.processor ?? r.lender_name ?? '(unmapped)'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return Array.from(m.entries())
      .map(([key, items]) => {
        const issues = items.filter((r) => r.e2e_status !== 'healthy').length
        const silent = items.filter((r) => r.e2e_status === 'silent_failure').length
        const broken = items.filter((r) => r.e2e_status === 'login_broken').length
        return { key, items, issues, silent, broken }
      })
      .sort((a, b) => {
        if (a.issues !== b.issues) return b.issues - a.issues
        return a.key.localeCompare(b.key)
      })
  }, [rows, groupBy])

  if (groups.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-12">
        <p className="text-sm text-gray-500 dark:text-gray-500">No groups to show.</p>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <GroupCard
          key={g.key}
          title={g.key}
          items={g.items}
          issues={g.issues}
          silent={g.silent}
          broken={g.broken}
          onScraperClick={onScraperClick}
        />
      ))}
    </div>
  )
}

function GroupCard({
  title,
  items,
  issues,
  silent,
  broken,
  onScraperClick,
}: {
  title: string
  items: ScraperRow[]
  issues: number
  silent: number
  broken: number
  onScraperClick: (r: ScraperRow) => void
}) {
  const [expanded, setExpanded] = useState(issues > 0)
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">{title}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
            {items.length} scraper{items.length === 1 ? '' : 's'}
            {issues > 0 && (
              <span className="text-red-600 dark:text-red-400"> • {issues} with issues</span>
            )}
            {broken > 0 && (
              <span className="text-red-600 dark:text-red-400"> • {broken} login broken</span>
            )}
            {silent > 0 && (
              <span className="text-orange-600 dark:text-orange-400"> • {silent} silent failure</span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-500">
          {expanded ? 'Hide' : 'Show'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-800">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900"
                onClick={() => onScraperClick(r)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-50">
                    {r.client_id} / {r.processor ?? r.lender_name ?? '—'} / {r.effective_gw}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-500">
                    {r.last_run_utc ? `Last run ${formatRelative(r.last_run_utc)}` : 'Never ran'}
                    {r.last_chargeback_date && ` • Latest CB ${r.last_chargeback_date}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <E2eBadge status={r.e2e_status} />
                  <SparklineRow pattern={r.pattern_7d} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

// =============================================================================
// Drawer — full per-scraper detail
// =============================================================================
function ScraperDrawer({
  row,
  onOpenChange,
}: {
  row: ScraperRow | null
  onOpenChange: (open: boolean) => void
}) {
  const open = row !== null
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-xl overflow-y-auto">
        {row && (
          <>
            <DrawerHeader>
              <DrawerTitle>
                <span className="tabular-nums">{row.client_id}</span> /{' '}
                {row.processor ?? row.lender_name ?? 'unmapped'} /{' '}
                <span className="tabular-nums">{row.effective_gw}</span>
              </DrawerTitle>
              <DrawerDescription>
                <E2eBadge status={row.e2e_status} />
                {row.lender_name && (
                  <span className="ml-2 text-gray-500 dark:text-gray-500">
                    Lender: {row.lender_name}
                  </span>
                )}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="space-y-5">
              <Section title="Last cron run">
                <Kv k="Status">
                  <CronStatusInline row={row} />
                </Kv>
                <Kv k="Time (IST)">{formatIst(row.last_run_utc)}</Kv>
                <Kv k="Rows downloaded">{formatInt(row.last_rows_exported)}</Kv>
                <Kv k="Duration">{formatSeconds(row.last_duration_seconds)}</Kv>
                {row.last_error && (
                  <div>
                    <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-500">
                      Error message
                    </p>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                      {row.last_error}
                    </pre>
                    {(() => {
                      const cat = classifyFailure(row.last_status ?? '', row.last_error)
                      return cat ? (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                          Category: <Badge variant="neutral">{FAILURE_CATEGORY_LABEL[cat]}</Badge>
                        </p>
                      ) : null
                    })()}
                  </div>
                )}
              </Section>

              <Section title="Production data (chargebacks_raw)">
                <Kv k="Latest chargeback date">
                  {row.last_chargeback_date ?? '—'}
                  {row.prod_data_age_days !== null && (
                    <span className="ml-1 text-gray-500 dark:text-gray-500">
                      ({row.prod_data_age_days}d ago)
                    </span>
                  )}
                </Kv>
                <Kv k="Last row landed (IST)">{formatIst(row.last_loaded_at_utc)}</Kv>
                <Kv k="Rows loaded — last 24h">{formatInt(row.rows_loaded_last_24h)}</Kv>
                <Kv k="Rows loaded — last 7d">{formatInt(row.rows_loaded_last_7d)}</Kv>
                <Kv k="Rows lifetime">{formatInt(row.rows_total_in_prod)}</Kv>
                {row.is_silent_failure && (
                  <p className="mt-2 rounded-md bg-orange-50 p-2 text-xs text-orange-800 dark:bg-orange-500/10 dark:text-orange-300">
                    <strong>Silent failure detected.</strong> The scraper reports success but no
                    fresh data has landed in chargebacks_raw — investigate the load step.
                  </p>
                )}
              </Section>

              <Section title="7-day cron pattern">
                <SparklineRow pattern={row.pattern_7d} large />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  Most recent on the left. Empty cells = no run for that slot in the last 14 days.
                </p>
                {row.consecutive_failures > 1 && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    Failing {row.consecutive_failures} consecutive runs.
                  </p>
                )}
              </Section>

              <Section title="Credentials (mid_manager)">
                <Kv k="Status">
                  <CredBadge value={row.credentials_status} />
                </Kv>
                <Kv k="Last checked (IST)">{formatIst(row.credentials_checked_utc)}</Kv>
                {row.credentials_message && (
                  <Kv k="Message">
                    <span className="text-gray-700 dark:text-gray-300">
                      {truncateError(row.credentials_message, 220)}
                    </span>
                  </Kv>
                )}
                <Kv k="Portal URL">
                  {row.portal_url ? (
                    <a
                      href={row.portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <span className="max-w-[260px] truncate">{row.portal_url}</span>
                      <RiExternalLinkLine className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    '—'
                  )}
                </Kv>
                <Kv k="Portal username">{row.portal_username ?? '—'}</Kv>
              </Section>

              <Section title="mid_manager record">
                <Kv k="ID">{row.id}</Kv>
                <Kv k="gateway_id">{row.gateway_id ?? '—'}</Kv>
                <Kv k="mid">{row.mid ?? '—'}</Kv>
                <Kv k="status">{row.mid_status ?? '—'}</Kv>
              </Section>
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
        {title}
      </h4>
      <div className="mt-2 space-y-1.5 text-sm">{children}</div>
    </section>
  )
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-500">{k}</span>
      <span className="min-w-0 truncate text-right text-sm text-gray-900 dark:text-gray-50">
        {children}
      </span>
    </div>
  )
}

// =============================================================================
// Bits and pieces
// =============================================================================
function E2eBadge({ status }: { status: E2eStatus }) {
  const tone = E2E_STATUS_TONE[status]
  const variant: 'success' | 'error' | 'warning' | 'neutral' =
    tone === 'emerald'
      ? 'success'
      : tone === 'red'
      ? 'error'
      : tone === 'orange' || tone === 'amber'
      ? 'warning'
      : 'neutral'
  return <Badge variant={variant}>{E2E_STATUS_LABEL[status]}</Badge>
}

function CronStatusInline({ row }: { row: ScraperRow }) {
  if (row.is_unmapped) return <Badge variant="neutral">Never ran</Badge>
  switch (row.last_status) {
    case 'success':
      return <Badge variant="success">Success</Badge>
    case 'no_data':
      return <Badge variant="neutral">No data</Badge>
    case 'failed':
      return <Badge variant="error">Failed</Badge>
    default:
      return <Badge variant="neutral">—</Badge>
  }
}

function CredBadge({ value }: { value: string | null }) {
  if (!value) return <Badge variant="neutral">—</Badge>
  if (value === 'Valid') return <Badge variant="success">Valid</Badge>
  if (value === 'Invalid') return <Badge variant="error">Invalid</Badge>
  return <Badge variant="warning">{value}</Badge>
}

function SparklineRow({
  pattern,
  large = false,
}: {
  pattern: (ScraperStatus | null)[]
  large?: boolean
}) {
  const cellSize = large ? 'size-4' : 'size-2.5'
  return (
    <span className="inline-flex items-center gap-0.5">
      {pattern.map((s, i) => {
        const color =
          s === 'success'
            ? 'bg-emerald-500'
            : s === 'no_data'
            ? 'bg-gray-400'
            : s === 'failed'
            ? 'bg-red-500'
            : 'bg-gray-200 dark:bg-gray-800'
        const label = s ?? 'no run'
        return (
          <span
            key={i}
            className={cx('block rounded-sm', cellSize, color)}
            title={`${i === 0 ? 'Latest' : `${i + 1}th most recent`} • ${label}`}
          />
        )
      })}
    </span>
  )
}

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <RiLoader4Line className="size-6 animate-spin" />
        <span>Loading scrapers…</span>
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
          Failed to load scrapers
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
