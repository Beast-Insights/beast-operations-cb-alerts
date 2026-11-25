'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RiLoader4Line, RiCloseCircleFill, RiRefreshLine, RiCheckboxCircleFill } from '@remixicon/react'

import { Card } from '@/components/Card'
import { Callout } from '@/components/Callout'
import { Badge } from '@/components/Badge'
import { Searchbar } from '@/components/Searchbar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/Select'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRoot } from '@/components/Table'

import type { PendingResponse, PendingRow, ScraperState } from '@/lib/disputeless/pending'
import { formatRelative } from '@/lib/recon/format'
import { cx } from '@/lib/utils'

const POLL_MS = 120_000

const STATE_LABEL: Record<ScraperState, string> = {
  not_built: 'Not built',
  failing: 'Failing',
  running: 'Running',
}
const STATE_VARIANT: Record<ScraperState, 'warning' | 'error' | 'success'> = {
  not_built: 'warning',
  failing: 'error',
  running: 'success',
}

export default function PendingScrapersPage() {
  const [data, setData] = useState<PendingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [client, setClient] = useState('all')
  const [processor, setProcessor] = useState('all')
  const [state, setState] = useState<'all' | ScraperState>('not_built')
  const [reason, setReason] = useState('all')

  const fetchData = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(`/api/disputeless/pending${manual ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`)
      setData((await res.json()) as PendingResponse)
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

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.rows.filter((r) => {
      if (client !== 'all' && r.client !== client) return false
      if (processor !== 'all' && r.processor !== processor) return false
      if (state !== 'all' && r.state !== state) return false
      if (reason !== 'all' && r.reason_code !== reason) return false
      if (q) {
        const blob = [r.client, r.corp_name, r.processor, r.merchant_id, r.descriptor, r.merchant_dba, r.reason, r.detail]
          .join(' ')
          .toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [data, search, client, processor, state, reason])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorState message={error} onRetry={() => void fetchData(true)} />
  if (!data) return null

  const s = data.summary

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {s.total} MIDs in the master sheet • {s.not_built} still need a scraper • Last refreshed{' '}
          {formatRelative(lastFetched)} • Auto-refresh every 2 min
        </p>
        <RefreshButton refreshing={refreshing} onClick={() => void fetchData(true)} />
      </div>

      {data.warnings.length > 0 && (
        <Callout title="Check the master sheet" variant="warning">
          <ul className="list-disc space-y-1 pl-4">
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Callout>
      )}

      {/* summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="MIDs in sheet" value={s.total} tone="text-gray-900 dark:text-gray-50" onClick={() => setState('all')} active={state === 'all'} />
        <Stat label="Scraper running" value={s.running} tone="text-emerald-600 dark:text-emerald-400" onClick={() => setState('running')} active={state === 'running'} />
        <Stat label="Scraper failing" value={s.failing} tone="text-red-600 dark:text-red-400" onClick={() => setState('failing')} active={state === 'failing'} />
        <Stat label="Scraper not built" value={s.not_built} tone="text-amber-600 dark:text-amber-400" onClick={() => setState('not_built')} active={state === 'not_built'} />
      </div>

      {/* by client */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Remaining scrapers by client</h3>
        <ul className="mt-3 space-y-3">
          {data.by_client.map((c) => (
            <li key={c.client}>
              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={() => setClient(client === c.client ? 'all' : c.client)}
                  className={cx('font-medium hover:underline', client === c.client ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200')}>
                  {c.client}
                </button>
                <span className="tabular-nums text-gray-500 dark:text-gray-500">
                  <span className="text-amber-600 dark:text-amber-400">{c.not_built} not built</span>
                  {c.failing > 0 && <> · <span className="text-red-600 dark:text-red-400">{c.failing} failing</span></>}
                  {' · '}<span className="text-emerald-600 dark:text-emerald-400">{c.running} running</span> / {c.total}
                </span>
              </div>
              <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <span style={{ width: `${(c.running / Math.max(1, c.total)) * 100}%` }} className="bg-emerald-500" />
                <span style={{ width: `${(c.failing / Math.max(1, c.total)) * 100}%` }} className="bg-red-500" />
                <span style={{ width: `${(c.not_built / Math.max(1, c.total)) * 100}%` }} className="bg-amber-500" />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* filters */}
      <Card className="p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Searchbar value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MID, client, processor, descriptor…" className="lg:col-span-1" />
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
              {data.filters.processors.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={state} onValueChange={(v) => setState(v as 'all' | ScraperState)}>
            <SelectTrigger><SelectValue placeholder="Scraper" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any scraper state</SelectItem>
              <SelectItem value="not_built">Not built</SelectItem>
              <SelectItem value="failing">Failing</SelectItem>
              <SelectItem value="running">Running</SelectItem>
            </SelectContent>
          </Select>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue placeholder="Reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any reason</SelectItem>
              {data.filters.reasons.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">Showing {filtered.length} of {data.rows.length}</div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12">
          <RiCheckboxCircleFill className="size-8 text-emerald-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-50">Nothing matches</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">Adjust the filters above</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TableRoot className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Scraper</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Processor / MID</TableHeaderCell>
                  <TableHeaderCell>Merchant</TableHeaderCell>
                  <TableHeaderCell>Why it isn&apos;t running</TableHeaderCell>
                  <TableHeaderCell>Sheet portal</TableHeaderCell>
                  <TableHeaderCell className="text-right">Last attempt</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((r) => <Row key={`${r.client}|${r.sheet_row}`} r={r} />)}
              </TableBody>
            </Table>
          </TableRoot>
        </Card>
      )}
    </div>
  )
}

function Row({ r }: { r: PendingRow }) {
  return (
    <TableRow>
      <TableCell><Badge variant={STATE_VARIANT[r.state]}>{STATE_LABEL[r.state]}</Badge></TableCell>
      <TableCell className="font-medium">{r.client}</TableCell>
      <TableCell>
        <span className="text-gray-900 dark:text-gray-50">{r.processor ?? '—'}</span>{' '}
        <span className="tabular-nums text-gray-500 dark:text-gray-500">/ {r.merchant_id ?? 'no MID'}</span>
      </TableCell>
      <TableCell className="max-w-[220px]">
        <div className="truncate text-gray-900 dark:text-gray-50" title={r.descriptor ?? undefined}>{r.descriptor ?? r.merchant_dba ?? '—'}</div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-500">{r.corp_name ?? ''}</div>
      </TableCell>
      <TableCell className="max-w-[260px] text-xs text-gray-600 dark:text-gray-400">
        <span title={r.detail ?? undefined}>{r.reason ?? (r.state === 'failing' ? (r.detail ? r.detail.slice(0, 90) : 'Last run failed') : '—')}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        <span className={cx(
          r.portal_status === 'Valid' ? 'text-emerald-600 dark:text-emerald-400'
          : r.portal_status === 'Invalid' ? 'text-red-600 dark:text-red-400'
          : 'text-gray-500 dark:text-gray-500')}>
          {r.portal_status || 'Not checked'}
        </span>
        <span className="ml-1 text-gray-400 dark:text-gray-600">· {r.has_portal_credentials ? 'creds in sheet' : 'no creds in sheet'}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-xs text-gray-500 dark:text-gray-500">
        {r.last_attempt_utc ? formatRelative(r.last_attempt_utc) : 'never'}
      </TableCell>
    </TableRow>
  )
}

function Stat({ label, value, tone, onClick, active }: { label: string; value: number; tone: string; onClick: () => void; active: boolean }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className={cx('p-4 transition-colors', active && 'ring-2 ring-blue-500/50')}>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-500">{label}</p>
        <p className={cx('mt-1 text-3xl font-semibold tabular-nums', tone)}>{value}</p>
      </Card>
    </button>
  )
}

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
        <RiLoader4Line className="size-6 animate-spin" /> <span>Reading the master sheet…</span>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <div className="flex flex-col items-center gap-3 p-2 text-center">
        <RiCloseCircleFill className="size-8 text-red-500" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">Failed to load pending scrapers</p>
        <p className="text-xs text-gray-500 dark:text-gray-500">{message}</p>
        <button type="button" onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900">
          <RiRefreshLine className="size-3.5" /> Retry
        </button>
      </div>
    </Card>
  )
}
