import type { AgentRow, ScrapersResponse } from '@/lib/recon/types';

/** Extra per-scraper detail shown in the drawer (mirrors the Chargeback Reporting drawer). */
export interface DisputelessDetail {
  org_name: string | null;
  descriptor: string | null;
  acquirer: string | null;
  // last cron run
  last_status: string | null; // success | no_data | failed | skipped
  last_rows_exported: number | null;
  last_error_message: string | null;
  skip_reason: string | null;
  consecutive_failures: number;
  // production data (raw_chargeback)
  last_chargeback_date: string | null; // YYYY-MM-DD
  chargeback_age_days: number | null;
  last_loaded_at_utc: string | null;
  rows_loaded_24h: number;
  rows_loaded_7d: number;
  rows_total: number;
  // credentials (processor_login)
  cred_status: string | null; // Valid | Invalid | Unchecked …
  cred_checked_utc: string | null;
  cred_message: string | null;
  portal_url: string | null;
  portal_username: string | null;
  // mid record
  mid_id: string | null;
  mid_number: string | null;
  mid_status: string | null;
}

export type DisputelessAgentRow = AgentRow & { detail: DisputelessDetail };
export type DisputelessScrapersResponse = Omit<ScrapersResponse, 'rows'> & { rows: DisputelessAgentRow[] };
