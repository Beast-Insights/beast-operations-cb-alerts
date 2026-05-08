# Deployment

This is a Next.js 14 app. Anything that runs Next.js will host it; this guide
covers the recommended path: **Vercel + GitHub**.

## Prerequisites

- Node 20+ locally (`node -v`).
- `git` configured with your GitHub identity.
- Access to the read-only Postgres user that the dashboard queries.

## 1. Local sanity check

```bash
cp .env.example .env.local
# Fill in DATABASE_URL (see .env.example for format)
npm install
npm run build
npm run dev
```

Open http://localhost:3000/cb — the dashboard should render with live data.

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: chargeback ops dashboard"
git remote add origin git@github.com:<org>/<repo>.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `.env*`, the diagnostic scripts that hold
hard-coded credentials, and the Tremor reference repos — verify with
`git status` before the first commit that none of those files are staged.

## 3. Deploy to Vercel

1. Sign in at vercel.com → **Add New… → Project**.
2. Import the GitHub repo.
3. **Framework preset**: Next.js (auto-detected). No build-command override.
4. **Environment Variables** — add the same vars from `.env.local`. At minimum:
   - `DATABASE_URL` → the production connection string.
   - Apply to **Production**, **Preview**, and **Development**.
5. Click **Deploy**. First build is ~2 min.

The deploy URL is `https://<project>.vercel.app`. Add a custom domain under
**Project Settings → Domains** if you have one.

## 4. Verify

- Visit `/cb` on the deployed URL — KPI cards and tables should populate.
- Open the browser network panel; `/api/cb/overview` should return 200 with a
  full payload (cache headers `X-Cache: HIT|MISS`).
- Check Vercel **Logs** (Project → Logs tab) for any pool-error stack traces.

## 5. Connection-pool considerations

Vercel runs each API route as a serverless function. With many concurrent
visitors each function can open its own pool of up to `PG_POOL_MAX`
connections. The defaults (5 per instance) are fine for a small team
polling every 60s, but if you start seeing `remaining connection slots`
errors:

- Lower `PG_POOL_MAX` to 2–3 in Vercel env vars.
- Or front the DB with a pooler (PgBouncer / Supavisor / Neon's built-in
  proxy) and point `DATABASE_URL` at the pooler.

## 6. Rotating credentials

The `beastinsights_ro` password was previously hard-coded in source and
shell history. Once the deploy is stable:

1. Have the DB owner rotate the password.
2. Update `DATABASE_URL` in Vercel → **Environment Variables**.
3. Redeploy (Vercel → Deployments → ⋯ → Redeploy).
4. Update your local `.env.local`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Database not configured` on first request | Missing env vars | Add `DATABASE_URL` in Vercel project settings, redeploy |
| `self-signed certificate` errors | `PGSSL=strict` against the upstream cert | Remove `PGSSL` or set it to `require` |
| Functions time out at 10s | Vercel Hobby tier function-duration cap | Either upgrade to Pro (60s) or reduce query work |
| `remaining connection slots` | DB pool exhaustion | Lower `PG_POOL_MAX` to 2 or move to a pooler |
