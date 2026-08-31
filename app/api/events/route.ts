import { env } from 'cloudflare:workers';
import { authorizeMutation } from '@/lib/security/request.ts';

export const runtime = 'edge';
type Statement = { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> } };
type RuntimeDb = { prepare(sql: string): Statement };

export async function GET(request: Request) {
  if (!authorizeMutation(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const roundId = new URL(request.url).searchParams.get('roundId'); if (!roundId || roundId.length > 120) return Response.json({ error: 'invalid_round_id' }, { status: 422 });
  const db = (env as unknown as { DB: RuntimeDb }).DB; const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { const seen = new Map<string, string>(); const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); void (async () => { try { for (let tick = 0; tick < 160 && !request.signal.aborted; tick += 1) { const attempts = await db.prepare('SELECT a.id, a.status, c.name AS contactName FROM call_attempts a JOIN contacts c ON c.id = a.contact_id WHERE a.round_id = ?').bind(roundId).all<{ id: string; status: string; contactName: string }>(); for (const attempt of attempts.results) { if (seen.get(attempt.id) !== attempt.status) { seen.set(attempt.id, attempt.status); send('attempt', attempt); } } const round = await db.prepare('SELECT winner_attempt_id AS winnerAttemptId, status FROM dial_rounds WHERE id = ?').bind(roundId).first<{ winnerAttemptId: string | null; status: string }>(); if (round?.winnerAttemptId && seen.get(round.winnerAttemptId) === 'connected') { send('connected', { winnerAttemptId: round.winnerAttemptId }); controller.close(); return; } if (attempts.results.length && attempts.results.every((attempt) => ['cancelled', 'busy', 'no_answer', 'voicemail', 'failed', 'completed'].includes(attempt.status))) { send('done', { ok: true }); controller.close(); return; } await new Promise((resolve) => setTimeout(resolve, 750)); } controller.close(); } catch (error) { send('error', { message: error instanceof Error ? error.message : 'event_stream_failed' }); controller.close(); } })(); } });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
