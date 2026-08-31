import { assertTransition } from './state-machine.ts';
import type { CallAttempt, DialRound, DialStore, ProviderEvent } from './types.ts';

export class MemoryDialStore implements DialStore {
  sellerAvailable = true;
  sellerBusy = false;
  private rounds = new Map<string, DialRound>();
  private roundByKey = new Map<string, string>();
  private attempts = new Map<string, CallAttempt>();
  private eventIds = new Set<string>();

  async createRound(round: DialRound, attempts: CallAttempt[]) {
    const existingId = this.roundByKey.get(round.idempotencyKey);
    if (existingId) {
      const existing = this.rounds.get(existingId)!;
      return { round: { ...existing }, attempts: await this.listAttempts(existing.id), created: false };
    }
    this.rounds.set(round.id, { ...round });
    this.roundByKey.set(round.idempotencyKey, round.id);
    for (const attempt of attempts) this.attempts.set(attempt.id, { ...attempt });
    return { round: { ...round }, attempts: attempts.map((attempt) => ({ ...attempt })), created: true };
  }

  async getRound(roundId: string) {
    const round = this.rounds.get(roundId);
    return round ? { ...round } : null;
  }

  async getAttempt(attemptId: string) {
    const attempt = this.attempts.get(attemptId);
    return attempt ? { ...attempt } : null;
  }

  async listAttempts(roundId: string) {
    return [...this.attempts.values()].filter((attempt) => attempt.roundId === roundId).map((attempt) => ({ ...attempt }));
  }

  async updateAttempt(attemptId: string, patch: Partial<CallAttempt>) {
    const current = this.attempts.get(attemptId);
    if (!current) throw new Error('ATTEMPT_NOT_FOUND');
    if (patch.status) assertTransition(current.status, patch.status);
    const updated = { ...current, ...patch };
    this.attempts.set(attemptId, updated);
    return { ...updated };
  }

  async tryClaimWinner(roundId: string, attemptId: string) {
    const round = this.rounds.get(roundId);
    if (!round || round.winnerAttemptId !== null) return false;
    round.winnerAttemptId = attemptId;
    round.status = 'winner_locked';
    this.rounds.set(roundId, round);
    return true;
  }

  async recordEvent(event: ProviderEvent) {
    if (this.eventIds.has(event.id)) return false;
    this.eventIds.add(event.id);
    return true;
  }
}
