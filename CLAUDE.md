# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Alerts Operations Dashboard

Next.js 14 + TypeScript dashboard reading `data.alerts_raw` on PostgreSQL.

## Commands
- Dev server: `npx next dev -p 3030` (must be port **3030**)
- Build / start: `npm run build` / `npm run start`
- No test or lint script; `next build` runs the TypeScript check.
- Path alias: `@/*` → repo root.

## Architecture
- App Router pages (`app/page.tsx`, `app/ops`, `app/alerts`, `app/processing`, `app/workflow`) — each is a self-contained client dashboard.
- API routes in `app/api/*/route.ts` are thin wrappers over raw SQL against `data.alerts_raw` (no ORM).
- Shared `pg.Pool` in `lib/db.ts` with `max: 2` — do not raise. Use `queryWithRetry()` for routes prone to connection-exhaustion (`53300`/`53400`).
- UI built on Tremor-derived components in `components/` + Radix. `tremor-blocks-ref/` and `tremor-raw-ref/` are read-only references (excluded from tsconfig) — do not import from them.

## Timezone rules (easy to get wrong)
- `alert_timestamp` = EST; `created_at` / `acknowledgement_timestamp` = UTC.
- UI toggles IST/EST (`components/TimezoneToggle.tsx`, stored in `localStorage` key `dashboard-timezone`).
- SQL intervals: UTC→IST `+5h30m`, UTC→EST `-5h`, EST→IST `+10h30m`, EST→EST none. Follow the pattern in `app/api/alerts/route.ts`.
- Use `formatDateLocal()` from `lib/utils.ts` to stringify dates — `toISOString()` shifts to UTC and can drop a day.

## Database
- Host `db.beastinsights.com:5432`, DB `postgres`, SSL required.
- Read-only user credentials live in `.env.local` (gitignored) — see `.env.example` for the variable names. Never paste the password in commits, docs, or chat.
- Alert types: `CDRN`, `RDR`, `issuer_alert`, `customerdispute_alert`. Ethoca = `issuer_alert + customerdispute_alert`.
- NEVER write to `data.alerts_raw`. NEVER run migrations.

## Billing context
- Disputifier (CDRN/RDR provider) rate is **$11/alert**; they have billed $13 on some invoices. Balance owed to us: **$813**.
- CDRN from closed descriptors is NOT billable: `MYPOWERHUT`, `CHEF-STATION`, `SERELYSTORE`, `SERELY STORE`, `BUYSHUFFLE`, `BUYSHUFFLE.COM`, `HORIZON-LANE`, `MYSHUFFLEDEALS`, `MYSHUFFLEDEALS.COM`, `BRLBOUTIQUE` (Borella Boutique). **BRL BOUTIQUE is a different, active descriptor.**
- Weekly billing (Mondays): prior Mon–Sun by `alert_timestamp`, counts by `alert_type`, subtract closed-descriptor CDRN.
- Full invoice ledger, SQL template, and weekly history live in `CONVERSATION_CONTEXT.md`.

## Google Sheet
ID `1U67L7oIgpyEASDpQw_FkZeoBirJOLb1cDHdmzgdiQzQ` under `sagar@sranalytics.io`. "today" tab = invoice review, "Sheet7" = alert-level detail.
