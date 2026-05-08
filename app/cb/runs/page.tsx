'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RiArrowRightLine,
  RiCloseCircleFill,
  RiLoader4Line,
  RiRefreshLine,
} from '@remixicon/react'

import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
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

import type { RunRow, RunsResponse, RunDetailRow } from '@/lib/cb/types'
import {
  formatIst,
  formatRelative,
  formatInt,
  formatCompact,
  formatSeconds,
} from '@/lib/cb/format'
import { classifyFailure, FAILURE_CATEGORY_LABEL, truncateError } from '@/lib/cb/classify'
import { cx } from '@/lib/utils'

const POLL_MS = 60_000
const PAGE_SIZE = 25

export default function CbRunsPage() {
  const [data, setData] = useState<RunsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedIso, setLastFetchedIso] = useState<string | null>(null)

  const [windowDays, setWindowDays] = useState<7 | 14 | 30 | 60>(14)
  const [page, setPage] = useState(1)
  const [drawerBatchId, setDrawerBatchId] = useState<number | null>(null)
  const [drawerData, setDrawerData] = useState<RunsResponse['detail'] | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

  // ?batch=N opens that run's drawer immediately
  useEffect(() => {
    const u = new URL(window.location.href)
    const b = u.searchParams.get('batch')
    if (b) {
      const n = Number.parseInt(b, 10)
      if (Number.isFinite(n)) setDrawerBatchId(n)
    }
  }, [])

  const fetchRuns = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch(manual ? '/api/cb/runs?refresh=1' : '/api/cb/runs', {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as RunsResponse
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

  const fetchDetail = useCallback(async (batchId: number, manual: boolean) => {
    setDrawerLoading(true)
    try {
      const url = `/api/cb/runs?batch=${batchId}${manual ? '&refresh=1' : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as RunsResponse
      setDrawerData(json.detail ?? null)
    } catch (e) {
      setDrawerData(null)
    } finally {
      setDrawerLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRuns(false)
    const id = setInterval(() => void fetchRuns(false), POLL_MS)
    return () => clearInterval(id)
  }, [fetchRuns])

  useEffect(() => {
    if (drawerBatchId !== null) void fetchDetail(drawerBatchId, false)
    else setDrawerData(null)
  }, [drawerBatchId, fetchDetail])

  const filteredRuns = useMemo(() => {
    if (!data) return []
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
    return data.runs.filter((r) => new Date(r.started_utc).getTime() >= cutoff)
  }, [data, windowDays])

  useEffect(() => {
    setPage(1)
  }, [windowDays])

  if (loading && !data) return <PageLoading />
  if (error && !data) return <PageError message={error} onRetry={() => void fetchRuns(true)} />
  if (!data) return null

  const pageRows = filteredRuns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE))

  return (
    <div className="space-y-5">
      {/* refresh strip */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {filteredRuns.length} runs in selected window • Last refreshed{' '}
          {formatRelative(lastFetchedIso)} • Auto-refresh every 60s
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={String(windowDays)}
            onValueChange={(v) => setWindowDays(Number(v) as 7 | 14 | 30 | 60)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => void fetchRuns(true)}
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
      </div>

      {/* Run table */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Run history</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            One row per cron run. Click to see every scraper outcome from that run.
          </p>
        </div>
        {pageRows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm text-gray-500 dark:text-gray-500">No runs in this window.</p>
          </div>
        ) : (
          <TableRoot className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Started (IST)</TableHeaderCell>
                  <TableHeaderCell>Duration</TableHeaderCell>
                  <TableHeaderCell className="text-right">Scrapers</TableHeaderCell>
                  <TableHeaderCell className="text-right">✓</TableHeaderCell>
                  <TableHeaderCell className="text-right">⚪</TableHeaderCell>
                  <TableHeaderCell className="text-right">✗</TableHeaderCell>
                  <TableHeaderCell className="text-right">Rows</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow
                    key={r.batch_id}
                    onClick={() => setDrawerBatchId(r.batch_id)}
                    className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/60"
                  >
                    <TableCell>
                      <div className="font-medium tabular-nums text-gray-900 dark:text-gray-50">
                        {formatIst(r.started_utc)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        {formatRelative(r.started_utc)}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-gray-600 dark:text-gray-400">
                      {formatSeconds(r.duration_seconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.scrapers}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {r.success}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-500">
                      {r.no_data}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={
                          r.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'
                        }
                      >
                        {r.failed}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {formatCompact(r.rows_total)}
                    </TableCell>
                    <TableCell>
                      <RiArrowRightLine className="size-4 text-gray-400" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-xs dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-500">
              Page {page} of {pageCount} • {filteredRuns.length} runs
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

      <RunDrawer
        batchId={drawerBatchId}
        detail={drawerData}
        loading={drawerLoading}
        runMeta={drawerBatchId ? data.runs.find((r) => r.batch_id === drawerBatchId) ?? null : null}
        onOpenChange={(open) => !open && setDrawerBatchId(null)}
      />
    </div>
  )
}

function RunDrawer({
  batchId,
  detail,
  loading,
  runMeta,
  onOpenChange,
}: {
  batchId: number | null
  detail: RunsResponse['detail'] | null
  loading: boolean
  runMeta: RunRow | null
  onOpenChange: (open: boolean) => void
}) {
  const open = batchId !== null
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl overflow-y-auto">
        {batchId !== null && (
          <>
            <DrawerHeader>
              <DrawerTitle>Cron run #{batchId}</DrawerTitle>
              <DrawerDescription>
                {runMeta ? (
                  <>
                    Started {formatIst(runMeta.started_utc)} • Duration{' '}
                    {formatSeconds(runMeta.duration_seconds)}
                  </>
                ) : (
                  'Loading…'
                )}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="space-y-4">
              {runMeta && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KvCard label="Scrapers" value={runMeta.scrapers} />
                  <KvCard label="Success" value={runMeta.success} color="emerald" />
                  <KvCard label="No data" value={runMeta.no_data} />
                  <KvCard
                    label="Failed"
                    value={runMeta.failed}
                    color={runMeta.failed > 0 ? 'red' : 'gray'}
                  />
                </div>
              )}

              <section>
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Per-scraper outcomes
                  </h4>
                  <span className="text-xs text-gray-500 dark:text-gray-500">
                    {detail ? `${detail.rows.length} rows` : ''}
                  </span>
                </div>

                {loading ? (
                  <div className="mt-3 flex items-center justify-center py-6">
                    <RiLoader4Line className="size-5 animate-spin text-gray-500" />
                  </div>
                ) : detail && detail.rows.length > 0 ? (
                  <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                    {detail.rows.map((r, i) => (
                      <li
                        key={`${r.client_id}|${r.processor}|${r.gateway_id}|${i}`}
                        className="px-3 py-2.5"
                      >
                        <RunOutcomeRow row={r} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
                    No outcomes for this run.
                  </p>
                )}
              </section>
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function RunOutcomeRow({ row }: { row: RunDetailRow }) {
  const cat = classifyFailure(row.status, row.error_message)
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-50">
            {row.client_id} / {row.processor} / {row.gateway_id}
          </p>
          {row.status === 'success' && <Badge variant="success">Success</Badge>}
          {row.status === 'no_data' && <Badge variant="neutral">No data</Badge>}
          {row.status === 'failed' && <Badge variant="error">Failed</Badge>}
        </div>
        {row.error_message && (
          <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">
            {truncateError(row.error_message, 180)}
          </p>
        )}
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
          {row.duration_seconds !== null && formatSeconds(row.duration_seconds)}
          {row.duration_seconds !== null && row.rows_exported !== null && ' • '}
          {row.rows_exported !== null && `${formatInt(row.rows_exported)} rows`}
          {(row.duration_seconds !== null || row.rows_exported !== null) && ' • '}
          {formatIst(row.ts_utc)}
        </p>
      </div>
      <div className="shrink-0">
        {cat && <Badge variant="neutral">{FAILURE_CATEGORY_LABEL[cat]}</Badge>}
      </div>
    </div>
  )
}

function KvCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: 'emerald' | 'red' | 'gray'
}) {
  const cls =
    color === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : color === 'red'
      ? 'text-red-600 dark:text-red-400'
      : color === 'gray'
      ? 'text-gray-500 dark:text-gray-400'
      : 'text-gray-900 dark:text-gray-50'
  return (
    <div className="rounded-md border border-gray-200 p-2 dark:border-gray-800">
      <p className="text-xs text-gray-500 dark:text-gray-500">{label}</p>
      <p className={cx('mt-0.5 text-lg font-semibold tabular-nums', cls)}>{formatInt(value)}</p>
    </div>
  )
}

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <RiLoader4Line className="size-6 animate-spin" />
        <span>Loading run history…</span>
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
          Failed to load run history
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
