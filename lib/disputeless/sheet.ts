/**
 * Read-only access to the "Disputeless - MIDs Master" Google Sheet (one tab per client).
 *
 * Uses a Google service account with no extra dependency: sign an RS256 JWT with
 * node:crypto, trade it for an access token, call the Sheets REST API.
 *
 * Env:
 *   MID_SHEET_ID                       id in the sheet URL
 *   GOOGLE_SERVICE_ACCOUNT_JSON        the key as one line of JSON   (Vercel / servers)
 *   GOOGLE_SERVICE_ACCOUNT_FILE        path to the key file          (local only)
 *
 * Tolerance (so a small edit in the sheet never breaks the page):
 *   - EVERY visible tab is read, so a new client tab is picked up automatically.
 *   - Column names are matched loosely: case, spaces, "_" and "-" are ignored and a few
 *     aliases are accepted ("Merchant ID" = "Merchant Id" = "MerchantID" = "MID" ...).
 *   - The header row is found in the first rows of the tab, not assumed to be row 1.
 *   - A tab we cannot understand (no Merchant ID column) is SKIPPED with a warning that the
 *     page shows; the other tabs still load.
 *
 * SECURITY: the sheet contains portal usernames/passwords and phone numbers. They are
 * read only to compute `has_portal_credentials` and are NEVER returned or logged.
 */
import { createSign } from 'crypto'
import { readFileSync } from 'fs'

export interface SheetMid {
  client: string // tab name
  sheet_row: number
  corp_name: string | null
  processor: string | null
  merchant_id: string | null
  merchant_dba: string | null
  descriptor: string | null
  portal_status: string | null
  crm: string | null
  rdr_status: string | null
  cdrn_status: string | null
  ethoca_status: string | null
  has_portal_credentials: boolean
}

export interface SheetRead {
  mids: SheetMid[]
  /** things a human should look at (skipped tabs, odd values). Shown on the page. */
  warnings: string[]
}

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

// ---------------------------------------------------------------- header matching
/** "Merchant ID", "merchant_id", "MerchantID ", "Merchant-Id" all become "merchantid". */
export const normHeader = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const ALIASES: Record<string, string[]> = {
  merchant_id: ['merchantid', 'mid', 'merchantnumber', 'merchantno', 'midnumber', 'merchantidnumber'],
  processor: ['processor', 'paymentprocessor'],
  corp_name: ['corpname', 'corporationname', 'corporation', 'companyname', 'company'],
  merchant_dba: ['merchantdba', 'dba'],
  descriptor: ['descriptor', 'billingdescriptor'],
  portal_status: ['portalstatus', 'portalloginstatus'],
  crm: ['crm'],
  rdr_status: ['rdrstatus'],
  cdrn_status: ['cdrnstatus'],
  ethoca_status: ['ethocastatus'],
  username: ['processorusername', 'portalusername', 'processorlogin', 'username'],
  password: ['processorpassword', 'portalpassword', 'password'],
}
const MERCHANT_ID_ALIASES = ALIASES.merchant_id
const HEADER_SEARCH_ROWS = 6

/** column index for every field we know, from one header row. */
function mapHeaders(row: unknown[]): Record<string, number> {
  const normed = row.map(normHeader)
  const map: Record<string, number> = {}
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = normed.findIndex((h) => h && names.includes(h))
    if (i >= 0) map[field] = i
  }
  return map
}

// ---------------------------------------------------------------- parsing (pure, testable)
export function parseTabs(tabs: { title: string; grid: string[][] }[]): SheetRead {
  const mids: SheetMid[] = []
  const warnings: string[] = []

  for (const { title, grid } of tabs) {
    if (!grid.some((r) => r.some((c) => String(c).trim()))) continue // empty tab: nothing to say

    // find the header row: the first of the top rows that has a Merchant ID column
    let headerAt = -1
    let cols: Record<string, number> = {}
    for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, grid.length); i++) {
      const m = mapHeaders(grid[i])
      if (m.merchant_id !== undefined) {
        headerAt = i
        cols = m
        break
      }
    }
    if (headerAt < 0) {
      warnings.push(
        `Tab "${title}" was skipped: no Merchant ID column found in its first ${HEADER_SEARCH_ROWS} rows ` +
          `(accepted names: Merchant ID, Merchant Id, MerchantID, MID, Merchant Number). ` +
          `If this tab is not a MID list, ignore this message.`,
      )
      continue
    }
    if (cols.processor === undefined) warnings.push(`Tab "${title}": no Processor column found.`)
    if (cols.descriptor === undefined && cols.merchant_dba === undefined)
      warnings.push(`Tab "${title}": no Descriptor / Merchant DBA column found.`)

    const at = (row: string[], field: string) => {
      const i = cols[field]
      return i !== undefined && i < row.length ? String(row[i]).trim() : ''
    }

    for (let i = headerAt + 1; i < grid.length; i++) {
      const row = grid[i]
      if (!row.some((c) => String(c).trim())) continue
      const merchant_id = at(row, 'merchant_id') || null
      const descriptor = at(row, 'descriptor') || null
      const merchant_dba = at(row, 'merchant_dba') || null
      if (!merchant_id && !descriptor && !merchant_dba) continue
      if (merchant_id && /^\d(\.\d+)?e\+\d+$/i.test(merchant_id)) {
        warnings.push(
          `Tab "${title}" row ${i + 1}: Merchant ID "${merchant_id}" looks like scientific notation ` +
            `(Excel/Sheets shortened it). Format the column as Plain text and re-enter it.`,
        )
      }
      mids.push({
        client: title.trim(),
        sheet_row: i + 1, // the row number you see in the sheet
        corp_name: at(row, 'corp_name') || null,
        processor: at(row, 'processor') || null,
        merchant_id,
        merchant_dba,
        descriptor,
        portal_status: at(row, 'portal_status') || null,
        crm: at(row, 'crm') || null,
        rdr_status: at(row, 'rdr_status') || null,
        cdrn_status: at(row, 'cdrn_status') || null,
        ethoca_status: at(row, 'ethoca_status') || null,
        // read the secrets ONLY to answer yes/no; they never leave this function
        has_portal_credentials: !!(at(row, 'username') && at(row, 'password')),
      })
    }
  }
  return { mids, warnings }
}

// ---------------------------------------------------------------- Google access
function loadKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE
  const text = raw?.trim() ? raw : file ? readFileSync(file, 'utf8') : null
  if (!text) {
    throw new Error(
      'Google key not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_FILE locally) and MID_SHEET_ID.',
    )
  }
  const key = JSON.parse(text) as ServiceAccountKey
  if (!key.client_email || !key.private_key) throw new Error('Google key is missing client_email / private_key')
  return key
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')

let token: { value: string; exp: number } | null = null

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.exp - 60_000) return token.value
  const key = loadKey()
  const iat = Math.floor(Date.now() / 1000)
  const uri = key.token_uri ?? 'https://oauth2.googleapis.com/token'
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: uri, iat, exp: iat + 3600 }))
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url')
  const res = await fetch(uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}). Is the key valid / not deleted?`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 }
  return token.value
}

async function sheetsGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    cache: 'no-store',
  })
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      `Google says ${res.status} for the sheet. Is MID_SHEET_ID right, and is the sheet shared with the service-account email?`,
    )
  }
  if (!res.ok) throw new Error(`Google Sheets error ${res.status}`)
  return (await res.json()) as T
}

export async function readSheetMids(): Promise<SheetRead> {
  const id = process.env.MID_SHEET_ID?.trim()
  if (!id) throw new Error('MID_SHEET_ID is not set')

  // every VISIBLE tab, so a new client tab is picked up with no code change
  const meta = await sheetsGet<{ sheets: { properties: { title: string; hidden?: boolean } }[] }>(
    `${id}?fields=sheets.properties(title,hidden)`,
  )
  const titles = meta.sheets.filter((s) => !s.properties.hidden).map((s) => s.properties.title)
  if (!titles.length) throw new Error('The sheet has no visible tabs')

  const qs = titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&')
  const got = await sheetsGet<{ valueRanges: { values?: string[][] }[] }>(`${id}/values:batchGet?${qs}`)

  return parseTabs(titles.map((title, i) => ({ title, grid: got.valueRanges[i]?.values ?? [] })))
}
