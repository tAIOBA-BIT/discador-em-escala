import { env } from 'cloudflare:workers';
import { D1AtomicStore } from '@/lib/persistence/d1-atomic-store.ts';
import { log } from '@/lib/observability/logger.ts';
import { TwilioProvider } from '@/lib/telephony/twilio-provider.ts';

export const runtime = 'edge';

type Statement = { bind(...values: unknown[]): { run(): Promise<{ meta: { changes?: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> } };
type RuntimeDb = { prepare(sql: string): Statement };

export async function POST(request: Request) {
  const config = twilioConfig();
  if (!config) return Response.json({ error: 'provider_not_configured' }, { status: 503 });
  const provider = new TwilioProvider(config); const params = new URLSearchParams(await request.text());
  const signature = request.headers.get('x-twilio-signature') ?? '';
  if (!(await provider.validateWebhook(request.url, params, signature))) return Response.json({ error: 'invalid_signature' }, { status: 401 });
  const callSid = params.get('CallSid'); const callStatus = params.get('CallStatus') ?? 'unknown';
  if (!callSid) return Response.json({ error: 'missing_call_sid' }, { status: 422 });

  const db = (env as unknown as { DB: RuntimeDb }).DB; const atomic = new D1AtomicStore(db);
  const externalEventId = `${callSid}:${callStatus}:${params.get('SequenceNumber') ?? params.get('Timestamp') ?? '0'}`;
  const attempt = await db.prepare('SELECT id, round_id AS roundId, status FROM call_attempts WHERE provider = ? AND provider_call_id = ?').bind('twilio', callSid).first<{ id: string; roundId: string; status: string }>();
  const payloadHash = await sha256(params.toString());
  if (!(await atomic.recordProviderEvent({ id: crypto.randomUUID(), provider: 'twilio', externalEventId, attemptId: attempt?.id ?? null, eventType: callStatus, payloadHash, occurredAt: Date.now() }))) {
    if (attempt) { const round = await db.prepare('SELECT winner_attempt_id AS winnerAttemptId FROM dial_rounds WHERE id = ?').bind(attempt.roundId).first<{ winnerAttemptId: string | null }>(); if (round?.winnerAttemptId === attempt.id) { const failures = await cancelPending(db, provider, attempt.roundId, attempt.id); if (failures) return Response.json({ accepted: false, duplicate: true, cancellationFailures: failures }, { status: 503 }); } }
    return Response.json({ accepted: true, duplicate: true });
  }
  if (!attempt) return Response.json({ accepted: true, matched: false });

  const answeredBy = params.get('AnsweredBy') ?? 'unknown';
  if (answeredBy.startsWith('machine')) {
    await db.prepare("UPDATE call_attempts SET status = 'voicemail', classification = 'machine', updated_at = ? WHERE id = ? AND status NOT IN ('winner','connected','completed')").bind(Date.now(), attempt.id).run();
    await cancelWithRetry(provider, callSid, `${attempt.roundId}:${attempt.id}:machine-detected`);
    return Response.json({ accepted: true, classification: 'machine' });
  }
  if (answeredBy === 'human') {
    const won = await atomic.tryClaimWinner(attempt.roundId, attempt.id);
    if (!won) {
      await provider.playLateAnswerMessage(callSid);
      await db.prepare("UPDATE call_attempts SET status = 'cancelled', classification = 'human', updated_at = ? WHERE id = ?").bind(Date.now(), attempt.id).run();
      return Response.json({ accepted: true, winner: false });
    }
    await db.prepare("UPDATE call_attempts SET status = 'winner', classification = 'human', answered_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), attempt.id).run();
    await provider.connectToSeller(callSid, `${attempt.roundId}:${attempt.id}:connect`);
    await db.prepare("UPDATE call_attempts SET status = 'connected', connected_at = ?, updated_at = ? WHERE id = ?").bind(Date.now(), Date.now(), attempt.id).run();
    const cancellationFailures = await cancelPending(db, provider, attempt.roundId, attempt.id);
    await db.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, correlation_id, metadata_redacted, created_at) VALUES (?, NULL, 'winner_connected', 'dial_round', ?, ?, ?, ?)").bind(`audit-${crypto.randomUUID()}`, attempt.roundId, externalEventId, JSON.stringify({ winnerAttemptId: attempt.id, cancellationFailures }), Date.now()).run();
    log('info', 'winner_connected', { roundId: attempt.roundId, attemptId: attempt.id, correlationId: externalEventId });
    if (cancellationFailures) return Response.json({ accepted: false, winner: true, cancellationFailures }, { status: 503 });
    return Response.json({ accepted: true, winner: true, cancellationFailures: 0 });
  }
  const mapped = ({ ringing: 'ringing', busy: 'busy', 'no-answer': 'no_answer', failed: 'failed', completed: 'completed' } as Record<string, string>)[callStatus];
  if (mapped) await db.prepare("UPDATE call_attempts SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('winner','connected','cancelled','completed')").bind(mapped, Date.now(), attempt.id).run();
  return Response.json({ accepted: true });
}

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID; const authToken = process.env.TWILIO_AUTH_TOKEN; const fromNumber = process.env.TWILIO_FROM_NUMBER; const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!accountSid || !authToken || !fromNumber || !publicBaseUrl) return null;
  return { accountSid, authToken, fromNumber, statusCallbackUrl: `${publicBaseUrl}/api/webhooks/twilio`, screeningTwimlUrl: `${publicBaseUrl}/api/twilio/twiml/wait`, bridgeTwimlUrl: `${publicBaseUrl}/api/twilio/twiml/bridge` };
}
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function cancelWithRetry(provider: TwilioProvider, callSid: string, key: string) { let failure: unknown; for (let index = 0; index < 3; index += 1) { try { await provider.cancelCall(callSid, key); return; } catch (error) { failure = error; if (index < 2) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** index)); } } throw failure; }
async function cancelPending(db: RuntimeDb, provider: TwilioProvider, roundId: string, winnerAttemptId: string) { const others = await db.prepare("SELECT id, provider_call_id AS providerCallId FROM call_attempts WHERE round_id = ? AND id <> ? AND status IN ('queued','starting','ringing','answered','human_confirmed')").bind(roundId, winnerAttemptId).all<{ id: string; providerCallId: string | null }>(); let failures = 0; await Promise.all(others.results.map(async (other) => { if (!other.providerCallId) return; try { await cancelWithRetry(provider, other.providerCallId, `${roundId}:${other.id}:cancel`); await db.prepare("UPDATE call_attempts SET status = 'cancelled', updated_at = ?, error_code = NULL WHERE id = ?").bind(Date.now(), other.id).run(); } catch { failures += 1; await db.prepare("UPDATE call_attempts SET error_code = 'CANCEL_RETRY_EXHAUSTED', updated_at = ? WHERE id = ?").bind(Date.now(), other.id).run(); } })); return failures; }
