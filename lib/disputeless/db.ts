import { Pool, type QueryResult, type QueryResultRow } from 'pg'

/**
 * Pool for the Disputeless Postgres server (separate from lib/db.ts).
 * The scrapper_krupa role has a very small connection limit and the scrapers
 * themselves use it, so keep this pool at ONE connection and short-lived.
 */
const g = globalThis as unknown as { disputelessPool: Pool | undefined }

function make(): Pool {
  const host = process.env.DISPUTELESS_PGHOST
  const user = process.env.DISPUTELESS_PGUSER
  const password = process.env.DISPUTELESS_PGPASSWORD
  const database = process.env.DISPUTELESS_PGDATABASE ?? 'disputeless'
  if (!host || !user || !password) {
    throw new Error(
      'Disputeless DB not configured. Set DISPUTELESS_PGHOST / PGUSER / PGPASSWORD / PGDATABASE ' +
        '(.env.local locally, Project Settings → Environment Variables on Vercel).',
    )
  }
  const p = new Pool({
    host,
    port: Number(process.env.DISPUTELESS_PGPORT ?? 5432),
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 3000,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
    allowExitOnIdle: true,
  })
  p.on('error', (err) => console.error('Disputeless pool error:', err.message))
  return p
}

export function getDisputelessPool(): Pool {
  if (!g.disputelessPool) g.disputelessPool = make()
  return g.disputelessPool
}

/** Query with retry — "too many connections for role" (53300) is transient. */
export async function disputelessQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  retries = 4,
): Promise<QueryResult<R>> {
  for (let i = 0; i < retries; i++) {
    try {
      return await getDisputelessPool().query<R>(text)
    } catch (err) {
      const code = (err as { code?: string }).code
      const msg = err instanceof Error ? err.message : String(err)
      if ((code === '53300' || msg.includes('too many connections')) && i < retries - 1) {
        await new Promise((r) => setTimeout(r, (i + 1) * 1500))
        continue
      }
      throw err
    }
  }
  throw new Error('disputelessQuery: exhausted retries')
}
