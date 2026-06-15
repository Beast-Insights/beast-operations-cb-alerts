'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RiLoader4Line, RiCloseCircleFill, RiRefreshLine, RiCheckboxCircleFill } from '@remixicon/react'

import { Card } from '@/components/Card'
import { Searchbar } from '@/components/Searchbar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/Select'
import {
  Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRoot,
} from '@/components/Table'
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/Drawer'

import type { AgentRow, ScrapersResponse, AgentStatus } from '@/lib/recon/types'
import { formatRelative, formatIst, formatSeconds, formatInt } from '@/lib/recon/format'
import { cx } from '@/lib/utils'
import { StatusBadge, Sparkline7, Pipeline, ErrorBox } from '../_shared'

const POLL_MS = 60_000

function procName(p: string | null): string {
  if (!p) return 'Unknown'
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ScrapersPage() {
  const [data, setData] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [client, setClient] = useState('all')
  const [processor, setProcessor] = useState('all')
  const [status, setStatus] = useState<'all' | AgentStatus>('all')
  const [drawer, setDrawer] = useState<AgentRow | null>(null)

  const fetchData = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(`/api/recon/scrapers${manual ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`)
      setData((await res.json()) as ScrapersResponse)
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
            placeholder="Search gateway, MID, processor, bank…"
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
                  <TableHeaderCell>Bank</TableHeaderCell>
                  <TableHeaderCell>Last run</TableHeaderCell>
                  <TableHeaderCell className="text-right">Open alerts</TableHeaderCell>
                  <TableHeaderCell className="text-right">Reconciled</TableHeaderCell>
                  <TableHeaderCell className="text-right">7-day</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((r) => {
                  const ok = r.status === 'healthy' || r.status === 'warning'
                  return (
                    <TableRow
                      key={`${r.client_id}|${r.gateway_id}`}
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
                      <TableCell className="text-right">
                        {r.open_alerts ? (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            {r.open_alerts}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-600">0</span>
                        )}
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
// Drawer — clean pipeline view, not raw logs
// ---------------------------------------------------------------------------
function ScraperDrawer({ row, onOpenChange }: { row: AgentRow | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={row !== null} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-xl overflow-y-auto">
        {row && (
          <>
            <DrawerHeader>
              <DrawerTitle>
                {procName(row.processor)} <span className="text-gray-500 dark:text-gray-500">/ GW {row.gateway_id}</span>
              </DrawerTitle>
              <DrawerDescription>
                <StatusBadge status={row.status} />
                <span className="ml-2 text-gray-500 dark:text-gray-500">
                  {row.bank ?? '—'} bank · MID {row.mid ?? '—'} · client {row.client_id}
                </span>
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="space-y-5">
              <RunBanner row={row} />
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                  Latest run · pipeline
                </h4>
                {row.runs[0] && <Pipeline steps={row.runs[0].steps} />}
              </section>
              {row.runs.length > 1 && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Previous runs ({row.runs.length - 1})
                  </h4>
                  <ul className="mt-2 space-y-2">
                    {row.runs.slice(1).map((rn) => <PrevRun key={rn.run_id} run={rn} />)}
                  </ul>
                </section>
              )}
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function RunBanner({ row }: { row: AgentRow }) {
  const r = row.runs[0]
  if (!r) return null
  const map: Record<string, { icon: string; title: string; box: string; text: string }> = {
    healthy: { icon: '✓', title: 'Completed successfully', box: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' },
    warning: { icon: '!', title: 'Completed with warnings', box: 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' },
    error: { icon: '✕', title: 'Run failed', box: 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400' },
    stale: { icon: '◴', title: 'Stale', box: 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900', text: 'text-gray-700 dark:text-gray-300' },
  }
  const m = map[row.status] ?? map.healthy
  return (
    <div className={cx('rounded-lg border p-3.5', m.box)}>
      <div className="flex items-start gap-3">
        <span className={cx('text-lg leading-none', m.text)}>{m.icon}</span>
        <div className="min-w-0 flex-1">
          <p className={cx('text-sm font-semibold', m.text)}>{m.title}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {r.final_message} · {formatIst(r.started_utc)} · took {formatSeconds(r.duration_seconds)}
            {r.open_alerts != null && ` · ${r.open_alerts} open alert(s)`}
          </p>
          {r.error && <ErrorBox error={r.error} />}
        </div>
      </div>
    </div>
  )
}

function PrevRun({ run }: { run: AgentRow['runs'][number] }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cx('text-gray-400 transition-transform', open && 'rotate-90')}>▸</span>
          <StatusBadge status={run.status} />
          <span className="truncate text-xs text-gray-500 dark:text-gray-500">{run.final_message}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs text-gray-500 dark:text-gray-500">
          {formatRelative(run.started_utc)} · {formatSeconds(run.duration_seconds)}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-800">
          {run.error && <ErrorBox error={run.error} />}
          <Pipeline steps={run.steps} />
        </div>
      )}
    </li>
  )
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
