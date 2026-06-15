import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/recon/build';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  try {
    const snap = await getSnapshot(refresh);
    return NextResponse.json(snap.scrapers, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/recon/scrapers] failed:', message);
    return NextResponse.json({ error: 'scrapers_query_failed', message }, {
      status: 500, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
