/**
 * "Pending scrapers": every MID in the master Google Sheet, matched against what the
 * Disputeless scrapers actually did (public.disputeless_scrapper_logs, via public.mid).
 *
 *   running   latest scrape = success / no_data
 *   failing   latest scrape = failed            (scraper exists but is broken)
 *   not_built latest scrape = skipped, or never scraped, or the MID isn't in the platform
 */
import { disputelessQuery } from './db'
import { readSheetMids, type SheetMid } from './sheet'

export type ScraperState = 'running' | 'failing' | 'not_built'

export type ReasonCode =
  | 'no_scraper'
  | 'mid_missing'
  | 'no_credentials'
  | 'email_forwarding'
  | 'never_run'
  | 'not_in_platform'
  | 'other_skip'
  | null

export interface PendingRow extends SheetMid {
  state: ScraperState
  reason_code: ReasonCode
  reason: string | null // human wording
  detail: string | null // raw skip reason / error from the log
  last_attempt_utc: string | null
  login_outcome: string | null
}

export interface PendingResponse {
  generated_at_utc: string
  /** things to look at in the sheet (skipped tab, odd Merchant ID ...) */
  warnings: string[]
  rows: PendingRow[]
  summary: { total: number; running: number; failing: number; not_built: number }
  by_client: { client: string; total: number; running: number; failing: number; not_built: number }[]
  filters: { clients: string[]; processors: string[]; reasons: { code: string; label: string }[] }
}

export const REASON_LABEL: Record<string, string> = {
  no_scraper: 'No scraper for this processor yet',
  mid_missing: 'MID number missing in the platform',
  no_credentials: 'Portal credentials not saved',
  email_forwarding: 'Email-code (2FA) forwarding not confirmed',
  never_run: 'Never run yet',
  not_in_platform: 'MID not found in the platform',
  other_skip: 'Skipped',
}

interface DbRow {
  processor_mid: string | null
  mid_number: string | null
  descriptor: string | null
  status: string | null
  skip_reason: string | null
  error_message: string | null
  login_outcome: string | null
  executed_at: Date | null
}

/**
 * Loose key for comparing a Merchant ID typed in the sheet with the platform's MID:
 * ignores spaces/dashes/case and leading zeros ("000000791319" == "791319" == " 0000-791319 ").
 */
export const midKey = (v: string | null | undefined): string =>
  (v ?? '').replace(/[\s\-_.]/g, '').toUpperCase().replace(/^0+(?=.)/, '')

const CACHE_MS = 120_000
let cache: { at: number; data: PendingResponse } | null = null

function reasonOf(skip: string | null): ReasonCode {
  const s = (skip ?? '').toLowerCase()
  if (!s) return 'other_skip'
  if (s.includes('no scraper')) return 'no_scraper'
  if (s.includes('mid missing')) return 'mid_missing'
  if (s.includes('forwarding') || s.includes('email-code') || s.includes('2fa')) return 'email_forwarding'
  if (s.includes('password') || s.includes('secret') || s.includes('credential')) return 'no_credentials'
  return 'other_skip'
}

export async function getPending(refresh = false): Promise<PendingResponse> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const { mids: sheet, warnings } = await readSheetMids()
  const db = await disputelessQuery<DbRow>(`
    SELECT m.processor_mid, m.mid_number, m.descriptor,
           l.status, l.skip_reason, l.error_message, l.login_outcome, l.executed_at
    FROM public.mid m
    LEFT JOIN LATERAL (
      SELECT status, skip_reason, error_message, login_outcome, executed_at
      FROM public.disputeless_scrapper_logs
      WHERE mid_id = m.id
      ORDER BY executed_at DESC, id DESC
      LIMIT 1
    ) l ON true
  `)

  const byNumber = new Map<string, DbRow>()
  const byDescriptor = new Map<string, DbRow>()
  for (const r of db.rows) {
    for (const k of [r.processor_mid, r.mid_number]) if (midKey(k)) byNumber.set(midKey(k), r)
    if (r.descriptor?.trim()) byDescriptor.set(r.descriptor.trim().toUpperCase(), r)
  }

  const rows: PendingRow[] = sheet.map((s) => {
    const hit =
      (s.merchant_id ? byNumber.get(midKey(s.merchant_id)) : undefined) ??
      (!s.merchant_id && s.descriptor ? byDescriptor.get(s.descriptor.toUpperCase()) : undefined)

    let state: ScraperState = 'not_built'
    let code: ReasonCode = null
    let detail: string | null = null
    if (!hit) {
      code = 'not_in_platform'
    } else if (!hit.status) {
      code = 'never_run'
    } else if (hit.status === 'success' || hit.status === 'no_data') {
      state = 'running'
    } else if (hit.status === 'failed') {
      state = 'failing'
      detail = (hit.error_message ?? '').slice(0, 300) || null
    } else {
      // skipped
      code = reasonOf(hit.skip_reason)
      detail = hit.skip_reason
    }
    return {
      ...s,
      state,
      reason_code: code,
      reason: code ? REASON_LABEL[code] : null,
      detail,
      last_attempt_utc: hit?.executed_at ? new Date(hit.executed_at).toISOString() : null,
      login_outcome: hit?.login_outcome ?? null,
    }
  })

  const order: Record<ScraperState, number> = { not_built: 0, failing: 1, running: 2 }
  rows.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      a.client.localeCompare(b.client) ||
      (a.processor ?? '').localeCompare(b.processor ?? ''),
  )

  const clients = Array.from(new Set(rows.map((r) => r.client))).sort()
  const data: PendingResponse = {
    generated_at_utc: new Date().toISOString(),
    warnings,
    rows,
    summary: {
      total: rows.length,
      running: rows.filter((r) => r.state === 'running').length,
      failing: rows.filter((r) => r.state === 'failing').length,
      not_built: rows.filter((r) => r.state === 'not_built').length,
    },
    by_client: clients.map((c) => {
      const list = rows.filter((r) => r.client === c)
      return {
        client: c,
        total: list.length,
        running: list.filter((r) => r.state === 'running').length,
        failing: list.filter((r) => r.state === 'failing').length,
        not_built: list.filter((r) => r.state === 'not_built').length,
      }
    }),
    filters: {
      clients,
      processors: Array.from(new Set(rows.map((r) => r.processor).filter(Boolean) as string[])).sort(),
      reasons: Array.from(new Set(rows.map((r) => r.reason_code).filter(Boolean) as string[])).map((code) => ({
        code,
        label: REASON_LABEL[code],
      })),
    },
  }
  cache = { at: Date.now(), data }
  return data
}
