'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiErrorWarningFill,
  RiAlertFill,
  RiInformationFill,
  RiLoader4Line,
  RiRefreshLine,
  RiCheckLine,
  RiArrowRightSLine,
  RiArrowDownSLine,
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

import type { ScraperRow, ScrapersResponse } from '@/lib/cb/types'
import {
  formatRelative,
  formatInt,
} from '@/lib/cb/format'
import { truncateError } from '@/lib/cb/classify'
import {
  ACTION_LABEL,
  ACTION_HOWTO,
  ACTION_TONE,
  ACTION_SEVERITY,
  buildActionQueue,
  computeProcessorReliability,
  loadInProgress,
  saveInProgress,
  loginGroupKey,
  type ActionCategory,
  type ActionGroup,
  type LoginGroup,
  type ProcessorReliability,
} from '@/lib/cb/reliability'
import { cx } from '@/lib/utils'

const POLL_MS = 60_000

// ============================================================================
// Page
// ============================================================================
export default function CbReliabilityPage() {
  const [data, setData] = useState<ScrapersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedIso, setLastFetchedIso] = useState<string | null>(null)
  const [inProgress, setInProgress] = useState<Set<string>>(new Set())

  // filters
  const [client, setClient] = useState('all')
  const [processor, setProcessor] = useState('all')
  const [actionFilter, setActionFilter] = useState<'open' | 'all' | 'resolved'>('open')
  const [search, setSearch] = useState('')

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

  useEffect(() => {
    setInProgress(loadInProgress())
  }, [])

  useEffect(() => {
    void fetchScrapers(false)
    const id = setInterval(() => void fetchScrapers(false), POLL_MS)
    return () => clearInterval(id)
  }, [fetchScrapers])

  const toggleInProgress = useCallback((key: string) => {
    setInProgress((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveInProgress(next)
      return next
    })
  }, [])

  // Derived
  const actionQueue = useMemo(() => (data ? buildActionQueue(data.rows) : []), [data])
  const reliability = useMemo(
    () => (data ? computeProcessorReliability(data.rows) : []),
    [data],
  )

  // Apply user filters to action queue
  const filteredActionQueue = useMemo(() => {
    const q = search.trim().toLowerCase()
    return actionQueue
      .map<ActionGroup>((g) => ({
        ...g,
        affectedGroups: g.affectedGroups.filter((lg) => {
          const isInProg = inProgress.has(loginGroupKey(lg))
          if (actionFilter === 'open' && isInProg) return false
          if (actionFilter === 'resolved' && !isInProg) return false
          if (client !== 'all' && lg.client_id !== client) return false
          const lp = (lg.processor ?? lg.lender_name ?? '').toLowerCase()
          if (processor !== 'all' && lp !== processor.toLowerCase()) return false
          if (q) {
            const blob = lg.members
              .map((m) => `${m.client_id} ${m.processor ?? ''} ${m.lender_name ?? ''} ${m.gateway_id ?? ''} ${m.mid ?? ''} ${m.portal_username ?? ''}`)
              .join(' ')
              .toLowerCase()
            if (!blob.includes(q)) return false
          }
          return true
        }),
      }))
      .filter((g) => g.affectedGroups.length > 0)
  }, [actionQueue, actionFilter, client, processor, search, inProgress])

  if (loading && !data) return <PageLoading />
  if (error && !data) return <PageError message={error} onRetry={() => void fetchScrapers(true)} />
  if (!data) return null

  const totalGateways = data.rows.length
  const healthyGateways = data.rows.filter((r) => r.e2e_status === 'healthy').length
  const totalAffected = filteredActionQueue.reduce((s, g) => s + g.affectedGatewayCount, 0)
  const totalActions = filteredActionQueue.length
  const inProgressCount = inProgress.size

  // Available filter values
  const allClients = Array.from(new Set(data.rows.map((r) => r.client_id))).sort()
  const allProcessors = Array.from(
    new Set(
      data.rows
        .map((r) => (r.processor ?? r.lender_name ?? '').toLowerCase())
        .filter(Boolean),
    ),
  ).sort()

  return (
    <div className="space-y-6">
      {/* refresh strip */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {healthyGateways}/{totalGateways} gateways healthy •{' '}
          {totalAffected} affected by {totalActions} action{totalActions === 1 ? '' : 's'} •
          {' '}Last refreshed {formatRelative(lastFetchedIso)} • Auto-refresh every 60s
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

      {/* Section A — ACTION QUEUE */}
      <ActionQueueSection
        groups={filteredActionQueue}
        inProgress={inProgress}
        onToggleInProgress={toggleInProgress}
        client={client}
        setClient={setClient}
        processor={processor}
        setProcessor={setProcessor}
        actionFilter={actionFilter}
        setActionFilter={setActionFilter}
        search={search}
        setSearch={setSearch}
        clients={allClients}
        processors={allProcessors}
        inProgressCount={inProgressCount}
      />

      {/* Section B — PROCESSOR RELIABILITY SCOREBOARD */}
      <ReliabilityScoreboard rows={reliability} />

      {/* Section C — GATEWAY ISSUE QUEUE (gateway-level, peers grouped) */}
      <GatewayIssueQueue
        groups={filteredActionQueue}
        inProgress={inProgress}
        onToggleInProgress={toggleInProgress}
      />
    </div>
  )
}

// ============================================================================
// SECTION A — Action Queue (the "what to do today" block)
// ============================================================================
function ActionQueueSection({
  groups,
  inProgress,
  onToggleInProgress,
  client, setClient, processor, setProcessor,
  actionFilter, setActionFilter, search, setSearch,
  clients, processors, inProgressCount,
}: {
  groups: ActionGroup[]
  inProgress: Set<string>
  onToggleInProgress: (k: string) => void
  client: string; setClient: (v: string) => void
  processor: string; setProcessor: (v: string) => void
  actionFilter: 'open' | 'all' | 'resolved'; setActionFilter: (v: 'open' | 'all' | 'resolved') => void
  search: string; setSearch: (v: string) => void
  clients: string[]; processors: string[]; inProgressCount: number
}) {
  const totalGw = groups.reduce((s, g) => s + g.affectedGatewayCount, 0)
  const totalActions = groups.length

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
            Action queue
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
            {totalActions === 0
              ? 'No open actions — everything healthy.'
              : `${totalActions} action${totalActions === 1 ? '' : 's'} can recover ${totalGw} gateway${totalGw === 1 ? '' : 's'}`}
            {inProgressCount > 0 && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">
                · {inProgressCount} marked in progress
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filter strip — always visible so it's always discoverable */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-3 dark:border-gray-800">
        <Searchbar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search gateway, MID, username…"
          className="min-w-[220px] flex-1"
        />
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={processor} onValueChange={setProcessor}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Processor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All processors</SelectItem>
            {processors.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as typeof actionFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open only</SelectItem>
            <SelectItem value="resolved">In progress only</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <RiCheckboxCircleFill className="size-9 text-emerald-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-50">All clear</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            No actions match your filters.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {groups.map((g) => (
            <li key={g.category}>
              <ActionGroupCard
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

function ActionGroupCard({
  group,
  inProgress,
  onToggle,
}: {
  group: ActionGroup
  inProgress: Set<string>
  onToggle: (k: string) => void
}) {
  const tone = ACTION_TONE[group.category]
  const Icon = tone === 'red'
    ? RiErrorWarningFill
    : tone === 'orange' || tone === 'amber'
    ? RiAlertFill
    : RiInformationFill
  const iconColor =
    tone === 'red' ? 'text-red-500'
    : tone === 'orange' ? 'text-orange-500'
    : tone === 'amber' ? 'text-amber-500'
    : 'text-blue-500'

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-3">
        <Icon className={cx('mt-0.5 size-5 shrink-0', iconColor)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
              {ACTION_LABEL[group.category]}
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-500">
              affects {group.affectedGatewayCount} gateway{group.affectedGatewayCount === 1 ? '' : 's'} · {group.affectedClientIds.size} client{group.affectedClientIds.size === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {ACTION_HOWTO[group.category]}
          </p>

          <ul className="mt-3 space-y-2">
            {group.affectedGroups.map((lg) => (
              <ActionRowLine
                key={loginGroupKey(lg)}
                lg={lg}
                inProgress={inProgress}
                onToggle={onToggle}
                category={group.category}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function ActionRowLine({
  lg,
  inProgress,
  onToggle,
  category,
}: {
  lg: LoginGroup
  inProgress: Set<string>
  onToggle: (k: string) => void
  category: ActionCategory
}) {
  const key = loginGroupKey(lg)
  const isInProgress = inProgress.has(key)
  const peerLabel = lg.members.length > 1
    ? `${lg.members.length} gateways: ${lg.members.map((m) => m.effective_gw).join(', ')}`
    : lg.primary.effective_gw
  const proc = lg.processor ?? lg.lender_name ?? '—'

  // Email template for IP block
  const ipBlockMailto = `mailto:?subject=${encodeURIComponent(
    `Whitelist request: ${proc} portal — IP 203.161.52.114`,
  )}&body=${encodeURIComponent(
    [
      `Hi ${proc} support team,`, '',
      `We have an automated chargeback-reporting integration that connects to your portal from a fixed IP address. We'd like to request you whitelist our outbound IP so we can resume daily access:`, '',
      `  Outbound IP: 203.161.52.114`,
      `  Portal user: ${lg.portal_username ?? '<<username>>'}`,
      `  Affected MIDs: ${lg.members.map((m) => m.mid ?? m.gateway_id ?? '?').join(', ')}`, '',
      `Could you confirm once whitelisted? Happy to provide additional info.`,
      `Thanks,`, '',
    ].join('\n'),
  )}`

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
        <div className="flex items-center gap-2 text-sm">
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
              / <span className="tabular-nums">{lg.members.map((m) => m.effective_gw).join('+')}</span>
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
          {lg.members.length > 1 && (
            <span className="ml-2 text-gray-400 dark:text-gray-600">
              · {peerLabel}
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
        {category === 'ip_blocked' && (
          <a
            href={ipBlockMailto}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            Email template
          </a>
        )}
        <button
          type="button"
          onClick={() => onToggle(key)}
          className={cx(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium border',
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

// ============================================================================
// SECTION B — Processor Reliability Scoreboard
// ============================================================================
function ReliabilityScoreboard({ rows }: { rows: ProcessorReliability[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
          Processor reliability
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
          7-day uptime per portal, sorted worst-first
        </p>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-800">
        <div className="grid grid-cols-12 gap-3 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-500">
          <div className="col-span-3">Processor</div>
          <div className="col-span-1 text-right">Gateways</div>
          <div className="col-span-2 text-right">Healthy now</div>
          <div className="col-span-2 text-right">7-day uptime</div>
          <div className="col-span-2">Recent runs</div>
          <div className="col-span-2 text-right">Loaded 24h</div>
        </div>
        {rows.map((r) => (
          <ReliabilityRow key={r.processor} row={r} />
        ))}
        {rows.length === 0 && (
          <p className="px-5 py-6 text-xs text-gray-500 dark:text-gray-500">
            No processors enabled.
          </p>
        )}
      </div>
    </Card>
  )
}

function ReliabilityRow({ row }: { row: ProcessorReliability }) {
  const tone =
    row.uptimePct >= 95 ? 'emerald'
    : row.uptimePct >= 70 ? 'amber'
    : 'red'
  const dotColor =
    tone === 'emerald' ? 'bg-emerald-500'
    : tone === 'amber' ? 'bg-amber-500'
    : 'bg-red-500'

  return (
    <Link
      href={`/cb/scrapers?processor=${encodeURIComponent(row.processor)}`}
      className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/60"
    >
      <div className="col-span-3">
        <span className="font-medium text-gray-900 dark:text-gray-50">{row.processor}</span>
      </div>
      <div className="col-span-1 text-right tabular-nums text-gray-700 dark:text-gray-300">
        {row.enabledGateways}
      </div>
      <div className="col-span-2 text-right tabular-nums">
        <span className={cx(tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400')}>
          {row.healthyNow}/{row.enabledGateways}
        </span>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2 tabular-nums">
        <span className={tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
          {row.uptimePct}%
        </span>
        <span className={cx('block size-2 rounded-full', dotColor)} />
      </div>
      <div className="col-span-2">
        <SparklineStrip pattern={row.recentSparkline} />
      </div>
      <div className="col-span-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
        {formatInt(row.rowsLoaded24h)}
      </div>
    </Link>
  )
}

function SparklineStrip({ pattern }: { pattern: ('success' | 'no_data' | 'failed' | null)[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {pattern.map((s, i) => {
        const color =
          s === 'success' ? 'bg-emerald-500'
          : s === 'no_data' ? 'bg-gray-400'
          : s === 'failed' ? 'bg-red-500'
          : 'bg-gray-200 dark:bg-gray-800'
        return <span key={i} className={cx('block size-2 rounded-sm', color)} />
      })}
    </span>
  )
}

// ============================================================================
// SECTION C — Gateway Issue Queue
// ============================================================================
function GatewayIssueQueue({
  groups,
  inProgress,
  onToggleInProgress,
}: {
  groups: ActionGroup[]
  inProgress: Set<string>
  onToggleInProgress: (k: string) => void
}) {
  const flat: { lg: LoginGroup; category: ActionCategory }[] = []
  for (const g of groups) {
    for (const lg of g.affectedGroups) {
      flat.push({ lg, category: g.category })
    }
  }
  flat.sort((a, b) => {
    const sd = ACTION_SEVERITY[b.category] - ACTION_SEVERITY[a.category]
    if (sd !== 0) return sd
    return b.lg.primary.consecutive_failures - a.lg.primary.consecutive_failures
  })

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
          Gateway issue queue
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
          Per-gateway view of every open issue · multi-gateway peers grouped by shared portal login
        </p>
      </div>
      {flat.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <RiCheckboxCircleFill className="size-8 text-emerald-500" />
          <p className="text-sm font-medium text-gray-900 dark:text-gray-50">
            No open gateway issues
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {flat.map((row, idx) => (
            <GatewayIssueRow
              key={loginGroupKey(row.lg) + ':' + idx}
              lg={row.lg}
              category={row.category}
              isInProgress={inProgress.has(loginGroupKey(row.lg))}
              onToggle={() => onToggleInProgress(loginGroupKey(row.lg))}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

function GatewayIssueRow({
  lg,
  category,
  isInProgress,
  onToggle,
}: {
  lg: LoginGroup
  category: ActionCategory
  isInProgress: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const tone = ACTION_TONE[category]
  const variant: 'success' | 'error' | 'warning' | 'neutral' =
    tone === 'red' ? 'error'
    : tone === 'orange' ? 'warning'
    : tone === 'amber' ? 'warning'
    : tone === 'emerald' ? 'success'
    : 'neutral'
  const proc = lg.processor ?? lg.lender_name ?? '—'

  return (
    <li className={cx(
      'transition-colors',
      isInProgress && 'bg-blue-50/40 dark:bg-blue-500/5',
    )}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900/60"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Badge variant={variant}>{ACTION_LABEL[category]}</Badge>
          <span className="truncate text-sm text-gray-900 dark:text-gray-50">
            <span className="font-medium tabular-nums">{lg.client_id}</span>
            <span className="text-gray-500 dark:text-gray-500"> / {proc} / </span>
            <span className="tabular-nums">
              {lg.members.length === 1 ? lg.primary.effective_gw : lg.members.map((m) => m.effective_gw).join('+')}
            </span>
          </span>
          {lg.members.length > 1 && (
            <Badge variant="neutral">{lg.members.length} peers</Badge>
          )}
          {isInProgress && (
            <Badge variant="default">In progress</Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-500">
          {lg.primary.last_run_utc && <span>{formatRelative(lg.primary.last_run_utc)}</span>}
          {open ? <RiArrowDownSLine className="size-4" /> : <RiArrowRightSLine className="size-4" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 bg-gray-50/40 px-5 py-3 text-xs dark:border-gray-800 dark:bg-gray-900/40">
          <Kv k="What to do">{ACTION_HOWTO[category]}</Kv>
          {lg.primary.last_error && (
            <Kv k="Last error">
              <span className="text-gray-700 dark:text-gray-300">{lg.primary.last_error}</span>
            </Kv>
          )}
          <Kv k="Portal user">{lg.portal_username ?? '—'}</Kv>
          {lg.members.length > 1 && (
            <Kv k="Peers (this login)">
              {lg.members.map((m) => m.effective_gw).join(', ')}
            </Kv>
          )}
          <Kv k="Cron status (latest)">{lg.primary.last_status ?? '—'}</Kv>
          <Kv k="Credential status">{lg.primary.credentials_status ?? '—'}</Kv>
          <Kv k="Latest CB date in DB">{lg.primary.last_chargeback_date ?? '—'}</Kv>
          <Kv k="Rows loaded last 24h">{formatInt(lg.primary.rows_loaded_last_24h)}</Kv>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/cb/scrapers?focus=${encodeURIComponent(`${lg.client_id}|${lg.processor ?? ''}|${lg.primary.effective_gw}`)}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              Open in Scrapers <RiArrowRightLine className="size-3.5" />
            </Link>
            <button
              type="button"
              onClick={onToggle}
              className={cx(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
                isInProgress
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-300'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900',
              )}
            >
              {isInProgress ? (<><RiCheckLine className="size-3.5" /> In progress</>) : 'Mark in progress'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500 sm:w-44">
        {k}
      </span>
      <span className="min-w-0 flex-1 break-words text-gray-900 dark:text-gray-50">
        {children}
      </span>
    </div>
  )
}

// ============================================================================
// Loading / error states
// ============================================================================
function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <RiLoader4Line className="size-6 animate-spin" />
        <span>Loading reliability…</span>
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
          Failed to load reliability
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
