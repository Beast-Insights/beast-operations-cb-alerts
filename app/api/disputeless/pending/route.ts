import { NextResponse } from 'next/server';
import { getPending } from '@/lib/disputeless/pending';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  try {
    return NextResponse.json(await getPending(refresh), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/disputeless/pending] failed:', message);
    return NextResponse.json({ error: 'pending_query_failed', message }, {
      status: 500, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
