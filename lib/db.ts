import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg'

/**
 * Shared PostgreSQL connection pool.
 *
 * Reads connection details from environment variables (in order of preference):
 *   1. DATABASE_URL — full connection string
 *      (e.g. postgresql://user:pass@host:5432/db?sslmode=require)
 *   2. PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE — split form
 *
 * Locally:   create .env.local at repo root (see .env.example).
 * Vercel:    add the same vars under Project Settings → Environment Variables.
 *
 * The pool is cached on globalThis so HMR and route handlers reuse one
 * connection set instead of opening a new pool per request — important
 * because the upstream DB has a tight max_connections budget.
 */

const globalForPg = globalThis as unknown as {
  pgPool: Pool | undefined
}

function buildPoolConfig(): PoolConfig {
  const url = process.env.DATABASE_URL
  // SSL: every chargeback DB we connect to requires SSL but uses certs
  // we can't validate from a Vercel function — keep rejectUnauthorized: false.
  // Override with PGSSL=disable for local plaintext, PGSSL=strict to enforce.
  const sslMode = process.env.PGSSL ?? 'require'
  const ssl =
    sslMode === 'disable'
      ? false
      : sslMode === 'strict'
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false }

  if (url) {
    return {
      connectionString: url,
      ssl,
      max: numFromEnv('PG_POOL_MAX', 5),
      idleTimeoutMillis: numFromEnv('PG_IDLE_MS', 5000),
      connectionTimeoutMillis: numFromEnv('PG_CONNECT_MS', 15000),
      query_timeout: numFromEnv('PG_QUERY_MS', 30000),
      allowExitOnIdle: true,
    }
  }

  const host = process.env.PGHOST
  const user = process.env.PGUSER
  const password = process.env.PGPASSWORD
  const database = process.env.PGDATABASE
  if (!host || !user || !password || !database) {
    throw new Error(
      'Database not configured. Set DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE. ' +
        'Locally, create .env.local from .env.example. On Vercel, add them under ' +
        'Project Settings → Environment Variables.',
    )
  }
  return {
    host,
    port: numFromEnv('PGPORT', 5432),
    user,
    password,
    database,
    ssl,
    max: numFromEnv('PG_POOL_MAX', 5),
    idleTimeoutMillis: numFromEnv('PG_IDLE_MS', 5000),
    connectionTimeoutMillis: numFromEnv('PG_CONNECT_MS', 15000),
    query_timeout: numFromEnv('PG_QUERY_MS', 30000),
    allowExitOnIdle: true,
  }
}

function numFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export const pool: Pool = globalForPg.pgPool ?? new Pool(buildPoolConfig())

// Handle pool errors gracefully instead of crashing the server.
pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message)
})

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = pool
}

// Query with retry — handles connection exhaustion gracefully.
export async function queryWithRetry<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
  retries = 3,
): Promise<QueryResult<R>> {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query<R>(text, params as unknown[])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: string }).code
      const isFatal =
        code === '53300' ||
        code === '53400' ||
        message.includes('remaining connection slots')
      if (isFatal && i < retries - 1) {
        console.warn(
          `DB connection exhausted, retry ${i + 1}/${retries} in ${(i + 1) * 2}s...`,
        )
        await new Promise((r) => setTimeout(r, (i + 1) * 2000))
        continue
      }
      throw err
    }
  }
  throw new Error('queryWithRetry: exhausted retries without throwing')
}

// Health check function.
export async function checkConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1')
    return result.rows.length > 0
  } catch (error) {
    console.error('Database connection check failed:', error)
    return false
  }
}
