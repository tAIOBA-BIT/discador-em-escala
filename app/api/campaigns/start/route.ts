import { env } from 'cloudflare:workers';
import { authorizeMutation, normalizeE164, withinCallingHours } from '@/lib/security/request.ts';
import { TwilioProvider } from '@/lib/telephony/twilio-provider.ts';

export const runtime = 'edge';
type Statement = { bind(...values: unknown[]): { run(): Promise<{ meta: { changes?: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> } };
type RuntimeDb = { prepare(sql: string): Statement };
type StartBody = { concurrency?: number; contacts?: Array<{ id: string; name: string; phone: string; doNotCall?: boolean; source?: string }> };

export async function POST(request: Request) {
  const actor = authorizeMutation(request); if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 });
  if ((process.env.TELEPHONY_PROVIDER ?? 'simulator') !== 'twilio') return Response.json({ error: 'real_provider_not_enabled' }, { status: 409 });
  const config = providerConfig(); if (!config) return Response.json({ error: 'provider_not_configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as StartBody | null; const concurrency = Number(body?.concurrency ?? 3);
  const providerLimit = Math.min(10, Number(process.env.PROVIDER_CONCURRENCY_LIMIT ?? 10));
  if (!body?.contacts?.length) return Response.json({ error: 'invalid_concurrency_or_contacts' }, { status: 422 });
  if (!Number.isInteger(concurrency) || concurrency < 1) return Response.json({ error: 'invalid_concurrency_or_contacts' }, { status: 422 });
  // Horário liberado 24h
  const selected = body.contacts.slice(0, concurrency); if (selected.some((contact) => contact.doNotCall)) return Response.json({ error: 'do_not_call_contact_selected' }, { status: 409 });
  const normalized = selected.map((contact) => ({ ...contact, phone: normalizeE164(contact.phone) }));
  const db = (env as unknown as { DB: RuntimeDb }).DB; if (!(await consumeRateLimit(db, `start:${actor.userId}`, 10, 60_000))) return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
  const maxAttempts = Math.max(1, Number(process.env.MAX_ATTEMPTS_PER_30_DAYS ?? 3)); const minRetryMs = Math.max(1, Number(process.env.MIN_RETRY_INTERVAL_MINUTES ?? 60)) * 60_000;
  for (const contact of normalized) {
    const hash = await sha256(contact.phone); const blocked = await db.prepare('SELECT id FROM blocklist WHERE phone_hash = ? AND (expires_at IS NULL OR expires_at > ?)').bind(hash, Date.now()).first<{ id: string }>(); if (blocked) return Response.json({ error: 'do_not_call_contact_selected' }, { status: 409 });
    const stats = await db.prepare(`SELECT COUNT(a.id) AS attempts, MAX(a.started_at) AS lastAttempt
      FROM contacts c JOIN users u ON u.id = c.owner_id LEFT JOIN call_attempts a ON a.contact_id = c.id AND a.started_at >= ?
      WHERE u.external_id = ? AND c.phone_e164 = ?`).bind(Date.now() - 30 * 86_400_000, actor.userId, contact.phone).first<{ attempts: number; lastAttempt: number | null }>();
    if ((stats?.attempts ?? 0) >= maxAttempts) return Response.json({ error: 'attempt_limit_reached' }, { status: 409 });
    if (stats?.lastAttempt && Date.now() - stats.lastAttempt < minRetryMs) return Response.json({ error: 'minimum_retry_interval' }, { status: 409 });
  }

  const idempotencyKey = request.headers.get('idempotency-key') ?? ''; if (idempotencyKey.length < 8 || idempotencyKey.length > 160) return Response.json({ error: 'invalid_idempotency_key' }, { status: 422 });
  const existing = await db.prepare('SELECT id FROM campaigns WHERE idempotency_key = ?').bind(idempotencyKey).first<{ id: string }>();
  if (existing) return existingCampaign(db, existing.id);

  const now = Date.now(); const userId = `user-${actor.userId}`; const campaignId = `campaign-${crypto.randomUUID()}`; const roundId = `round-${crypto.randomUUID()}`;
  await db.prepare("INSERT OR IGNORE INTO users (id, external_id, email, display_name, availability, created_at, updated_at) VALUES (?, ?, ?, ?, 'available', ?, ?)").bind(userId, actor.userId, actor.email, actor.email, now, now).run();
  const inserted = await db.prepare("INSERT OR IGNORE INTO campaigns (id, owner_id, name, status, concurrency, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)").bind(campaignId, userId, `Rodada ${new Date(now).toISOString()}`, concurrency, idempotencyKey, now, now).run();
  if (inserted.meta.changes !== 1) { const raced = await db.prepare('SELECT id FROM campaigns WHERE idempotency_key = ?').bind(idempotencyKey).first<{ id: string }>(); return existingCampaign(db, raced!.id); }
  await db.prepare("INSERT INTO dial_rounds (id, campaign_id, status, winner_attempt_id, idempotency_key, started_at, created_at, updated_at) VALUES (?, ?, 'starting', NULL, ?, ?, ?, ?)").bind(roundId, campaignId, `${idempotencyKey}:round`, now, now, now).run();
  await db.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, correlation_id, metadata_redacted, created_at) VALUES (?, ?, 'campaign_started', 'dial_round', ?, ?, ?, ?)").bind(`audit-${crypto.randomUUID()}`, userId, roundId, idempotencyKey, JSON.stringify({ concurrency, contactCount: normalized.length, provider: 'twilio' }), now).run();

  const provider = new TwilioProvider(config); const attempts: Array<{ id: string; contactId: string; contactName: string; status: string }> = [];
  await Promise.all(normalized.map(async (contact, index) => {
    const contactId = `contact-${crypto.randomUUID()}`; const attemptId = `${roundId}-a${index + 1}`;
    await db.prepare('INSERT INTO contacts (id, owner_id, name, phone_e164, source, do_not_call, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').bind(contactId, userId, String(contact.name).slice(0, 120), contact.phone, String(contact.source ?? 'painel').slice(0, 80), now, now).run();
    await db.prepare("INSERT INTO call_attempts (id, round_id, contact_id, provider, status, version, created_at, updated_at) VALUES (?, ?, ?, 'twilio', 'starting', 0, ?, ?)").bind(attemptId, roundId, contactId, now, now).run();
    try {
      const call = await provider.startCall({ attemptId, to: contact.phone, roundId, idempotencyKey: `${idempotencyKey}:${attemptId}:start` });
      await db.prepare("UPDATE call_attempts SET provider_call_id = ?, status = 'ringing', started_at = ?, updated_at = ? WHERE id = ?").bind(call.providerCallId, Date.now(), Date.now(), attemptId).run();
      attempts.push({ id: attemptId, contactId: contact.id, contactName: contact.name, status: 'ringing' });
    } catch (error) {
      await db.prepare("UPDATE call_attempts SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?").bind(error instanceof Error ? error.message : 'START_FAILED', Date.now(), attemptId).run();
      attempts.push({ id: attemptId, contactId: contact.id, contactName: contact.name, status: 'failed' });
    }
  }));
  await db.prepare("UPDATE dial_rounds SET status = 'dialing', updated_at = ? WHERE id = ?").bind(Date.now(), roundId).run();
  return Response.json({ campaignId, roundId, attempts }, { status: 202 });
}

async function existingCampaign(db: RuntimeDb, campaignId: string) {
  const round = await db.prepare('SELECT id FROM dial_rounds WHERE campaign_id = ? ORDER BY started_at DESC LIMIT 1').bind(campaignId).first<{ id: string }>();
  const attempts = round ? await db.prepare('SELECT a.id, a.contact_id AS contactId, c.name AS contactName, a.status FROM call_attempts a JOIN contacts c ON c.id = a.contact_id WHERE a.round_id = ?').bind(round.id).all<{ id: string; contactId: string; contactName: string; status: string }>() : { results: [] };
  return Response.json({ campaignId, roundId: round?.id, attempts: attempts.results, duplicate: true }, { status: 200 });
}
async function consumeRateLimit(db: RuntimeDb, key: string, limit: number, windowMs: number) {
  const now = Date.now(); const existing = await db.prepare('SELECT count, window_started_at AS startedAt FROM rate_limits WHERE key = ?').bind(key).first<{ count: number; startedAt: number }>();
  if (!existing || now - existing.startedAt >= windowMs) { await db.prepare('INSERT INTO rate_limits (key, window_started_at, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_started_at = excluded.window_started_at, count = 1').bind(key, now).run(); return true; }
  const updated = await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ? AND count < ?').bind(key, limit).run(); return updated.meta.changes === 1;
}
function providerConfig() { const accountSid = process.env.TWILIO_ACCOUNT_SID; const authToken = process.env.TWILIO_AUTH_TOKEN; const fromNumber = process.env.TWILIO_FROM_NUMBER; const publicBaseUrl = process.env.PUBLIC_BASE_URL; if (!accountSid || !authToken || !fromNumber || !publicBaseUrl) return null; return { accountSid, authToken, fromNumber, statusCallbackUrl: `${publicBaseUrl}/api/webhooks/twilio`, screeningTwimlUrl: `${publicBaseUrl}/api/twilio/twiml/wait`, bridgeTwimlUrl: `${publicBaseUrl}/api/twilio/twiml/bridge` }; }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
