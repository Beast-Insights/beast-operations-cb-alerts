'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RiLoader4Line, RiCloseCircleFill, RiRefreshLine, RiCheckboxCircleFill, RiExternalLinkLine } from '@remixicon/react'

import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { Searchbar } from '@/components/Searchbar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/Select'
import {
  Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRoot,
} from '@/components/Table'
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/Drawer'

import type { AgentStatus } from '@/lib/recon/types'
import type { DisputelessAgentRow, DisputelessScrapersResponse } from '@/lib/disputeless/types'
import { formatRelative, formatIst, formatSeconds, formatInt } from '@/lib/recon/format'
import { cx } from '@/lib/utils'
import { StatusBadge, Sparkline7 } from '../../recon/_shared'

const POLL_MS = 60_000

// Processors whose names are acronyms and should render fully uppercase
// rather than title-cased (e.g. "pps" → "PPS", not "Pps").
const PROC_ACRONYMS = new Set(['pps'])

function procName(p: string | null): string {
  if (!p) return 'Unknown'
  if (PROC_ACRONYMS.has(p.toLowerCase())) return p.toUpperCase()
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ScrapersPage() {
  const [data, setData] = useState<DisputelessScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [client, setClient] = useState('all')
  const [processor, setProcessor] = useState('all')
  const [status, setStatus] = useState<'all' | AgentStatus>('all')
  const [drawer, setDrawer] = useState<DisputelessAgentRow | null>(null)

  const fetchData = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(`/api/disputeless/scrapers${manual ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`)
      setData((await res.json()) as DisputelessScrapersResponse)
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
    const u = new URL(window.location.href)
    if (u.searchParams.get('client')) setClient(u.searchParams.get('client')!)
    if (u.searchParams.get('status')) setStatus(u.searchParams.get('status') as AgentStatus)
  }, [])

  useEffect(() => {
    void fetchData(false)
    const id = setInterval(() => void fetchData(false), POLL_MS)
    return () => clearInterval(id)
  }, [fetchData])

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter((r) => {
      if (client !== 'all' && r.client_id !== client) return false
      if (processor !== 'all' && r.processor !== processor) return false
      if (status !== 'all' && r.status !== status) return false
      if (q) {
        const blob = [r.client_id, r.processor, r.bank, r.gateway_id, r.mid, r.last_message].join(' ').toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [data, search, client, processor, status])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorState message={error} onRetry={() => void fetchData(true)} />
  if (!data) return null

  const issues = data.rows.filter((r) => r.status !== 'healthy').length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {data.rows.length} scrapers • {issues} with issues • Last refreshed {formatRelative(lastFetched)} • Auto-refresh every 60s
        </p>
        <RefreshButton refreshing={refreshing} onClick={() => void fetchData(true)} />
      </div>

      <Card className="p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Searchbar
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MID, client, processor, login…"
            className="lg:col-span-2"
          />
          <Select value={client} onValueChange={setClient}>
            <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {data.filters.clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={processor} onValueChange={setProcessor}>
            <SelectTrigger><SelectValue placeholder="Processor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All processors</SelectItem>
              {data.filters.processors.map((p) => <SelectItem key={p} value={p}>{procName(p)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as 'all' | AgentStatus)}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="stale">Stale</SelectItem>
              <SelectItem value="healthy">Healthy</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">
          Showing {filtered.length} of {data.rows.length}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12">
          <RiCheckboxCircleFill className="size-8 text-emerald-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-50">No scrapers match</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">Adjust the filters above</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TableRoot className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Scraper</TableHeaderCell>
                  <TableHeaderCell>Login</TableHeaderCell>
                  <TableHeaderCell>Last run</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rows exported</TableHeaderCell>
                  <TableHeaderCell className="text-right">7-day</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((r) => {
                  const ok = r.status === 'healthy' || r.status === 'warning'
                  return (
                    <TableRow
                      key={`${r.client_id}|${r.processor}|${r.gateway_id}|${r.mid}`}
                      onClick={() => setDrawer(r)}
                      className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/60"
                    >
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="font-medium tabular-nums">{r.client_id}</TableCell>
                      <TableCell>
                        <span className="text-gray-900 dark:text-gray-50">{procName(r.processor)}</span>{' '}
                        <span className="tabular-nums text-gray-500 dark:text-gray-500">/ {r.gateway_id}</span>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-400">{r.bank ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span className={ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                          {ok ? '✓' : '✕'}
                        </span>{' '}
                        <span className="text-gray-500 dark:text-gray-500">{formatRelative(r.last_run_utc)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-gray-600 dark:text-gray-400">
                        {r.reconciled != null ? formatInt(r.reconciled) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end"><Sparkline7 days={r.days7} /></div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableRoot>
        </Card>
      )}

      <ScraperDrawer row={drawer} onOpenChange={(o) => !o && setDrawer(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer — per-scraper detail (same layout as the Chargeback Reporting drawer)
// ---------------------------------------------------------------------------
function ScraperDrawer({ row, onOpenChange }: { row: DisputelessAgentRow | null; onOpenChange: (o: boolean) => void }) {
  const d = row?.detail
  return (
    <Drawer open={row !== null} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-xl overflow-y-auto">
        {row && d && (
          <>
            <DrawerHeader>
              <DrawerTitle>
                <span>{row.client_id}</span> / {procName(row.processor)} /{' '}
                <span className="tabular-nums">{row.gateway_id}</span>
              </DrawerTitle>
              <DrawerDescription>
                <StatusBadge status={row.status} />
                {d.descriptor && (
                  <span className="ml-2 text-gray-500 dark:text-gray-500">
                    Descriptor: {d.descriptor}{d.acquirer ? ` · ${d.acquirer}` : ''}
                  </span>
                )}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="space-y-5">
              <Section title="Last cron run">
                <Kv k="Status"><CronStatus status={d.last_status} /></Kv>
                <Kv k="Time (IST)">{formatIst(row.last_run_utc)}</Kv>
                <Kv k="Rows downloaded">{formatInt(d.last_rows_exported)}</Kv>
                <Kv k="Duration">{formatSeconds(row.last_duration)}</Kv>
                {(d.last_error_message || d.skip_reason) && (
                  <div>
                    <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-500">
                      {d.last_error_message ? 'Error message' : 'Skip reason'}
                    </p>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                      {d.last_error_message ?? d.skip_reason}
                    </pre>
                  </div>
                )}
              </Section>

              <Section title="Production data (raw_chargeback)">
                <Kv k="Latest chargeback date">
                  {d.last_chargeback_date ?? '—'}
                  {d.chargeback_age_days !== null && (
                    <span className="ml-1 text-gray-500 dark:text-gray-500">({d.chargeback_age_days}d ago)</span>
                  )}
                </Kv>
                <Kv k="Last row landed (IST)">{formatIst(d.last_loaded_at_utc)}</Kv>
                <Kv k="Rows loaded — last 24h">{formatInt(d.rows_loaded_24h)}</Kv>
                <Kv k="Rows loaded — last 7d">{formatInt(d.rows_loaded_7d)}</Kv>
                <Kv k="Rows lifetime">{formatInt(d.rows_total)}</Kv>
                {d.last_status === 'success' && (d.last_rows_exported ?? 0) > 0 && d.rows_loaded_24h === 0 && (
                  <p className="mt-2 rounded-md bg-orange-50 p-2 text-xs text-orange-800 dark:bg-orange-500/10 dark:text-orange-300">
                    <strong>Silent failure detected.</strong> The scraper reports success but no fresh data has
                    landed in raw_chargeback — investigate the load step.
                  </p>
                )}
              </Section>

              <Section title="7-day cron pattern">
                <Sparkline7 days={[...row.days7].reverse()} large />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                  Most recent on the left. Empty cells = no run for that day.
                </p>
                {d.consecutive_failures > 1 && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    Failing {d.consecutive_failures} consecutive runs.
                  </p>
                )}
              </Section>

              <Section title="Credentials (processor_login)">
                <Kv k="Status"><CredBadge value={d.cred_status} /></Kv>
                <Kv k="Last checked (IST)">{formatIst(d.cred_checked_utc)}</Kv>
                {d.cred_message && (
                  <Kv k="Message">
                    <span className="text-gray-700 dark:text-gray-300">
                      {d.cred_message.length > 220 ? d.cred_message.slice(0, 217) + '…' : d.cred_message}
                    </span>
                  </Kv>
                )}
                <Kv k="Portal URL">
                  {d.portal_url ? (
                    <a href={d.portal_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                      <span className="max-w-[260px] truncate">{d.portal_url}</span>
                      <RiExternalLinkLine className="size-3.5 shrink-0" />
                    </a>
                  ) : '—'}
                </Kv>
                <Kv k="Portal username">{d.portal_username ?? '—'}</Kv>
              </Section>

              <Section title="MID record">
                <Kv k="ID">{d.mid_id ? d.mid_id.slice(0, 8) : '—'}</Kv>
                <Kv k="mid">{d.mid_number ?? '—'}</Kv>
                <Kv k="status">{d.mid_status ?? '—'}</Kv>
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
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">{title}</h4>
      <div className="mt-2 space-y-1.5 text-sm">{children}</div>
    </section>
  )
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-500">{k}</span>
      <span className="min-w-0 truncate text-right text-sm text-gray-900 dark:text-gray-50">{children}</span>
    </div>
  )
}

function CronStatus({ status }: { status: string | null }) {
  switch (status) {
    case 'success': return <Badge variant="success">Success</Badge>
    case 'no_data': return <Badge variant="neutral">No data</Badge>
    case 'failed': return <Badge variant="error">Failed</Badge>
    case 'skipped': return <Badge variant="warning">Skipped</Badge>
    default: return <Badge variant="neutral">—</Badge>
  }
}

function CredBadge({ value }: { value: string | null }) {
  if (!value) return <Badge variant="neutral">—</Badge>
  if (value === 'Valid') return <Badge variant="success">Valid</Badge>
  if (value === 'Invalid') return <Badge variant="error">Invalid</Badge>
  return <Badge variant="warning">{value}</Badge>
}

// ---------------------------------------------------------------------------
function RefreshButton({ refreshing, onClick }: { refreshing: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      className={cx('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
        'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900',
        refreshing && 'opacity-60')}
    >
      <RiRefreshLine className={cx('size-3.5', refreshing && 'animate-spin')} /> Refresh
    </button>
  )
}

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <RiLoader4Line className="size-6 animate-spin" /> <span>Loading scrapers…</span>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <div className="flex flex-col items-center gap-3 p-2 text-center">
        <RiCloseCircleFill className="size-8 text-red-500" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">Failed to load scrapers</p>
        <p className="text-xs text-gray-500 dark:text-gray-500">{message}</p>
        <button type="button" onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">
          <RiRefreshLine className="size-3.5" /> Retry
        </button>
      </div>
    </Card>
  )
}
