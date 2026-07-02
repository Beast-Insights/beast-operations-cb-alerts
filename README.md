# Beast Deposit Reconciliation Agent Status

A live operations dashboard for the daily reconciliation agent. Same design
system as the chargeback ops board, but driven entirely by one table:
**`reconciliation.beast_recon_v2_agent_logs`**.

Two tabs:

- **Health Overview** — KPI cards (active scrapers, latest-run health, open
  alerts, healthy gateways by client), a 30-day run-history grid, a per-client
  healthy-runs trend, and a 7-day activity panel.
- **Scrapers** — a filterable table (search + client + processor + status), one
  row per `client + gateway`, with a 7-day activity strip. Click a row for a
  clean **pipeline view** of the latest run — a ✓/!/✕ per phase, the exact
  failing phase + error when something breaks, and previous runs — not raw logs.

## How a "scraper" is defined

Each row is one `(client_id, gateway_id)`. Its status comes from the latest run:

- **Healthy** — the reconciliation completed with no errors, and the only
  warnings (if any) were in the downstream steps (`gather_inputs` → `persist`).
  Those amber steps are still shown on their own pipeline row but do **not**
  downgrade the run.
- **Warning** — it completed, but a phase *up to and including the bank scrape*
  warned (e.g. partial bank data).
- **Error** — any phase logged a hard error (✕) — including a failed **bank
  login** — or the reconciliation did not complete. The failing phase is shown
  red and is named in the run's exception box.
- **Stale** — last healthy run is older than 36h.

> Note: a run-phase SUCCESS is treated as the source of truth. A later
> `UnicodeEncodeError: "...failed and was skipped"` is a known cp1252 console
> logging artifact on the daily VM — it does **not** mark the run failed.

## Run it

```bash
cp .env.example .env.local   # fill PGPASSWORD (or set DATABASE_URL)
npm install
npm run dev                  # http://localhost:3000  → redirects to /ops
```

Data is server-cached for 55s and the pages auto-refresh every 60s. Deploy to
Vercel by adding the same env vars under Project Settings → Environment Variables.

## Where the logic lives

- `lib/recon/build.ts` — one query, rolls rows up into agents + overview aggregates (cached).
- `lib/recon/status.ts` — run-status / pipeline-step derivation (ported from the validated Python).
- `app/api/ops/{overview,scrapers}/route.ts` — JSON endpoints.
- `app/ops/*` — the two pages + shared UI.
