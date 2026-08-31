import { env } from 'cloudflare:workers';
import { authorizeMutation } from '@/lib/security/request.ts';
import { TwilioProvider } from '@/lib/telephony/twilio-provider.ts';

export const runtime = 'edge';
type Statement = { bind(...values: unknown[]): { run(): Promise<{ meta: { changes?: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> } };
type RuntimeDb = { prepare(sql: string): Statement };

export async function POST(request: Request) {
  const actor = authorizeMutation(request); if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null) as { roundId?: string } | null; if (!body?.roundId) return Response.json({ error: 'invalid_round_id' }, { status: 422 });
  const db = (env as unknown as { DB: RuntimeDb }).DB;
  const owned = await db.prepare('SELECT r.id FROM dial_rounds r JOIN campaigns p ON p.id = r.campaign_id JOIN users u ON u.id = p.owner_id WHERE r.id = ? AND u.external_id = ?').bind(body.roundId, actor.userId).first<{ id: string }>();
  if (!owned) return Response.json({ error: 'round_not_found' }, { status: 404 });
  const config = providerConfig(); if (!config) return Response.json({ error: 'provider_not_configured' }, { status: 503 }); const provider = new TwilioProvider(config);
  const active = await db.prepare("SELECT id, provider_call_id AS providerCallId FROM call_attempts WHERE round_id = ? AND status IN ('queued','starting','ringing','answered','human_confirmed','winner','connected')").bind(body.roundId).all<{ id: string; providerCallId: string | null }>();
  const failures: string[] = [];
  await Promise.all(active.results.map(async (attempt) => { if (!attempt.providerCallId) return; try { await provider.cancelCall(attempt.providerCallId, `${body.roundId}:${attempt.id}:manual-stop`); await db.prepare("UPDATE call_attempts SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), attempt.id).run(); } catch { failures.push(attempt.id); } }));
  await db.prepare("UPDATE dial_rounds SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), body.roundId).run();
  return Response.json({ stopped: true, cancellationFailures: failures }, { status: failures.length ? 207 : 200 });
}
function providerConfig() { const accountSid = process.env.TWILIO_ACCOUNT_SID; const authToken = process.env.TWILIO_AUTH_TOKEN; const fromNumber = process.env.TWILIO_FROM_NUMBER; const publicBaseUrl = process.env.PUBLIC_BASE_URL; if (!accountSid || !authToken || !fromNumber || !publicBaseUrl) return null; return { accountSid, authToken, fromNumber, statusCallbackUrl: `${publicBaseUrl}/api/webhooks/twilio`, screeningTwimlUrl: `${publicBaseUrl}/api/twilio/twiml/wait`, bridgeTwimlUrl: `${publicBaseUrl}/api/twilio/twiml/bridge` }; }
