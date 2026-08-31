import { env } from 'cloudflare:workers';
import { authorizeMutation } from '@/lib/security/request.ts';

export const runtime = 'edge';
type Statement = { bind(...values: unknown[]): { run(): Promise<{ meta: { changes?: number } }>; first<T>(): Promise<T | null> } };
type RuntimeDb = { prepare(sql: string): Statement };
const outcomes = new Set(['interested', 'callback', 'sale', 'not_interested', 'invalid_number']);

export async function POST(request: Request) {
  const actor = authorizeMutation(request); if (!actor) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null) as { attemptId?: string; outcome?: string; notes?: string; doNotCall?: boolean } | null;
  if (!body?.attemptId || !body.outcome || !outcomes.has(body.outcome) || String(body.notes ?? '').length > 4000) return Response.json({ error: 'invalid_result' }, { status: 422 });
  const db = (env as unknown as { DB: RuntimeDb }).DB;
  const owned = await db.prepare(`SELECT a.id, a.contact_id AS contactId, a.round_id AS roundId, c.phone_e164 AS phone
    FROM call_attempts a JOIN dial_rounds r ON r.id = a.round_id JOIN campaigns p ON p.id = r.campaign_id
    JOIN users u ON u.id = p.owner_id JOIN contacts c ON c.id = a.contact_id
    WHERE a.id = ? AND u.external_id = ? AND a.status = 'connected'`).bind(body.attemptId, actor.userId).first<{ id: string; contactId: string; roundId: string; phone: string }>();
  if (!owned) return Response.json({ error: 'attempt_not_found_or_not_connected' }, { status: 404 });
  const notesEncrypted = body.notes ? await encryptNotes(body.notes) : null; const now = Date.now();
  await db.prepare('INSERT OR IGNORE INTO call_results (id, attempt_id, owner_id, outcome, notes_encrypted, do_not_call, created_at, updated_at) SELECT ?, ?, p.owner_id, ?, ?, ?, ?, ? FROM dial_rounds r JOIN campaigns p ON p.id = r.campaign_id WHERE r.id = ?').bind(`result-${crypto.randomUUID()}`, owned.id, body.outcome, notesEncrypted, body.doNotCall ? 1 : 0, now, now, owned.roundId).run();
  await db.prepare("UPDATE call_attempts SET status = 'completed', ended_at = ?, updated_at = ? WHERE id = ?").bind(now, now, owned.id).run();
  await db.prepare("UPDATE dial_rounds SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").bind(now, now, owned.roundId).run();
  if (body.doNotCall) { const hash = await sha256(owned.phone); await db.prepare("INSERT OR IGNORE INTO blocklist (id, phone_hash, reason, source, blocked_at) VALUES (?, ?, 'contact_request', 'call_result', ?)").bind(`block-${crypto.randomUUID()}`, hash, now).run(); await db.prepare('UPDATE contacts SET do_not_call = 1, updated_at = ? WHERE id = ?').bind(now, owned.contactId).run(); }
  await db.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, correlation_id, metadata_redacted, created_at) SELECT ?, p.owner_id, 'call_result_saved', 'call_attempt', ?, ?, ?, ? FROM dial_rounds r JOIN campaigns p ON p.id = r.campaign_id WHERE r.id = ?").bind(`audit-${crypto.randomUUID()}`, owned.id, `result:${owned.id}`, JSON.stringify({ outcome: body.outcome, doNotCall: Boolean(body.doNotCall) }), now, owned.roundId).run();
  return Response.json({ saved: true });
}

async function encryptNotes(value: string) {
  const encoded = process.env.DATA_ENCRYPTION_KEY; if (!encoded) throw new Error('DATA_ENCRYPTION_KEY_NOT_CONFIGURED');
  const raw = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)); if (raw.length !== 32) throw new Error('DATA_ENCRYPTION_KEY_MUST_BE_32_BYTES');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)));
  return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}
function toBase64(bytes: Uint8Array) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
