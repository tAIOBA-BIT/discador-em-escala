export type D1Like = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<{ meta: { changes?: number } }>; first<T>(): Promise<T | null> } } };

export class D1AtomicStore {
  private readonly db: D1Like;
  constructor(db: D1Like) { this.db = db; }

  async tryClaimWinner(roundId: string, attemptId: string): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE dial_rounds SET winner_attempt_id = ?, status = 'winner_locked', updated_at = ? WHERE id = ? AND winner_attempt_id IS NULL`,
    ).bind(attemptId, Date.now(), roundId).run();
    return result.meta.changes === 1;
  }

  async recordProviderEvent(input: { id: string; provider: string; externalEventId: string; attemptId: string | null; eventType: string; payloadHash: string; occurredAt: number }): Promise<boolean> {
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO provider_events (id, provider, external_event_id, attempt_id, event_type, payload_hash, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(input.id, input.provider, input.externalEventId, input.attemptId, input.eventType, input.payloadHash, input.occurredAt, Date.now()).run();
    return result.meta.changes === 1;
  }
}
