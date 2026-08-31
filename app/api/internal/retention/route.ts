import { env } from 'cloudflare:workers';
import { log } from '@/lib/observability/logger.ts';

export const runtime = 'edge';
type Statement = { bind(...values: unknown[]): { run(): Promise<{ meta: { changes?: number } }> } };
type RuntimeDb = { prepare(sql: string): Statement };

export async function POST(request: Request) {
  const expected = process.env.RETENTION_JOB_TOKEN ?? ''; const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || !constantTimeEqual(expected, received)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const retentionDays = boundedDays(process.env.RETENTION_DAYS, 90); const notesDays = boundedDays(process.env.NOTES_RETENTION_DAYS, 30);
  const db = (env as unknown as { DB: RuntimeDb }).DB; const eventCutoff = Date.now() - retentionDays * 86_400_000; const notesCutoff = Date.now() - notesDays * 86_400_000;
  const events = await db.prepare('DELETE FROM provider_events WHERE received_at < ?').bind(eventCutoff).run();
  const audit = await db.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(eventCutoff).run();
  const notes = await db.prepare('UPDATE call_results SET notes_encrypted = NULL WHERE updated_at < ? AND notes_encrypted IS NOT NULL').bind(notesCutoff).run();
  log('info', 'retention_completed', { retentionDays, notesDays, deletedEvents: events.meta.changes ?? 0, deletedAudit: audit.meta.changes ?? 0, clearedNotes: notes.meta.changes ?? 0 });
  return Response.json({ deletedEvents: events.meta.changes ?? 0, deletedAudit: audit.meta.changes ?? 0, clearedNotes: notes.meta.changes ?? 0 });
}
function boundedDays(value: string | undefined, fallback: number) { const parsed = Number(value ?? fallback); return Number.isFinite(parsed) ? Math.min(3650, Math.max(1, Math.floor(parsed))) : fallback; }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let mismatch = 0; for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index); return mismatch === 0; }
