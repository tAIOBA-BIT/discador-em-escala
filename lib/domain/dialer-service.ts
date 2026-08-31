import { canTransition, isCancellable } from './state-machine.ts';
import type { AnswerClassification, CallAttempt, DialStore, ProviderEvent, StartRoundInput, TelephonyProvider } from './types.ts';

export type DialerMetrics = {
  started: number;
  answered: number;
  cancelled: number;
  failed: number;
  abandoned: number;
  answerToConnectMs: number[];
};

export type HandleEventResult = {
  duplicate: boolean;
  winner: boolean;
  classification?: AnswerClassification;
  reason?: string;
  winnerAttemptId?: string;
  ignoredOutOfOrder?: boolean;
};

export class DialerService {
  readonly metrics: DialerMetrics = { started: 0, answered: 0, cancelled: 0, failed: 0, abandoned: 0, answerToConnectMs: [] };
  private readonly store: DialStore;
  private readonly provider: TelephonyProvider;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    store: DialStore,
    provider: TelephonyProvider,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) { this.store = store; this.provider = provider; this.sleep = sleep; }

  async startRound(input: StartRoundInput) {
    if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 10) throw new Error('INVALID_CONCURRENCY');
    if (!this.store.sellerAvailable) throw new Error('SELLER_UNAVAILABLE');
    if (this.store.sellerBusy) throw new Error('SELLER_BUSY');
    const contacts = input.contacts.slice(0, input.concurrency);
    const now = input.now ?? Date.now();
    for (const contact of contacts) {
      if (contact.doNotCall) throw new Error(`DO_NOT_CALL:${contact.id}`);
      if ((contact.attemptsInWindow ?? 0) >= 3) throw new Error(`ATTEMPT_LIMIT:${contact.id}`);
      if (contact.lastAttemptAt && now - contact.lastAttemptAt < 60 * 60 * 1000) throw new Error(`MIN_RETRY_INTERVAL:${contact.id}`);
    }

    const attempts: CallAttempt[] = contacts.map((contact, index) => ({
      id: `${input.roundId}-a${index + 1}`,
      roundId: input.roundId,
      contactId: contact.id,
      contactName: contact.name,
      phoneE164: contact.phoneE164,
      status: 'queued',
      providerCallId: null,
      classification: null,
      errorCode: null,
    }));
    const created = await this.store.createRound({
      id: input.roundId,
      idempotencyKey: input.idempotencyKey,
      status: 'starting',
      winnerAttemptId: null,
      concurrency: input.concurrency,
    }, attempts);
    if (!created.created) return created;

    await Promise.all(created.attempts.map(async (attempt) => {
      await this.store.updateAttempt(attempt.id, { status: 'starting' });
      try {
        const started = await this.provider.startCall({
          attemptId: attempt.id,
          to: attempt.phoneE164,
          idempotencyKey: `${input.idempotencyKey}:${attempt.id}:start`,
          roundId: input.roundId,
        });
        await this.store.updateAttempt(attempt.id, { providerCallId: started.providerCallId, status: 'ringing' });
        this.metrics.started += 1;
      } catch (error) {
        await this.store.updateAttempt(attempt.id, { status: 'failed', errorCode: error instanceof Error ? error.message : 'START_FAILED' });
        this.metrics.failed += 1;
      }
    }));
    return { ...created, attempts: await this.store.listAttempts(input.roundId) };
  }

  async handleEvent(event: ProviderEvent): Promise<HandleEventResult> {
    if (!(await this.store.recordEvent(event))) return { duplicate: true, winner: false };
    let attempt = await this.store.getAttempt(event.attemptId);
    if (!attempt) throw new Error('ATTEMPT_NOT_FOUND');

    if (event.type === 'ringing') return this.safeTransition(attempt, 'ringing');
    if (event.type === 'busy' || event.type === 'no_answer' || event.type === 'failed' || event.type === 'completed') {
      const result = await this.safeTransition(attempt, event.type, event.errorCode);
      if (event.type === 'failed') this.metrics.failed += 1;
      return result;
    }
    if (event.type !== 'answered') return { duplicate: false, winner: false };

    this.metrics.answered += 1;
    if (canTransition(attempt.status, 'answered')) attempt = await this.store.updateAttempt(attempt.id, { status: 'answered' });
    const classification = event.classification ?? 'unknown';
    if (classification === 'machine') {
      await this.store.updateAttempt(attempt.id, { status: 'voicemail', classification });
      return { duplicate: false, winner: false, classification };
    }
    if (classification === 'unknown') {
      await this.store.updateAttempt(attempt.id, { classification });
      return { duplicate: false, winner: false, classification };
    }

    attempt = await this.store.updateAttempt(attempt.id, { status: 'human_confirmed', classification });
    if (!this.store.sellerAvailable) {
      if (attempt.providerCallId) await this.provider.playLateAnswerMessage(attempt.providerCallId);
      await this.store.updateAttempt(attempt.id, { status: 'cancelled' });
      this.metrics.abandoned += 1;
      return { duplicate: false, winner: false, reason: 'seller_unavailable' };
    }

    const claimed = await this.store.tryClaimWinner(attempt.roundId, attempt.id);
    if (!claimed) {
      if (attempt.providerCallId) {
        await this.provider.playLateAnswerMessage(attempt.providerCallId);
        await this.cancelWithRetry(attempt, 'late-answer');
      }
      return { duplicate: false, winner: false, reason: 'winner_already_locked' };
    }

    const answeredAt = event.occurredAt ?? Date.now();
    attempt = await this.store.updateAttempt(attempt.id, { status: 'winner' });
    this.store.sellerBusy = true;
    if (!attempt.providerCallId) throw new Error('PROVIDER_CALL_ID_MISSING');
    await this.provider.connectToSeller(attempt.providerCallId, `${attempt.roundId}:${attempt.id}:connect`);
    await this.store.updateAttempt(attempt.id, { status: 'connected' });
    this.metrics.answerToConnectMs.push(Math.max(0, Date.now() - answeredAt));

    const others = (await this.store.listAttempts(attempt.roundId)).filter((candidate) => candidate.id !== attempt.id && isCancellable(candidate.status));
    await Promise.all(others.map((candidate) => this.cancelWithRetry(candidate, 'winner-selected')));
    return { duplicate: false, winner: true, winnerAttemptId: attempt.id };
  }

  async finishConversation(roundId: string) {
    const round = await this.store.getRound(roundId);
    if (!round?.winnerAttemptId) throw new Error('WINNER_NOT_FOUND');
    const winner = await this.store.getAttempt(round.winnerAttemptId);
    if (winner?.status === 'connected') await this.store.updateAttempt(winner.id, { status: 'completed' });
    this.store.sellerBusy = false;
  }

  private async safeTransition(attempt: CallAttempt, status: CallAttempt['status'], errorCode?: string): Promise<HandleEventResult> {
    if (!canTransition(attempt.status, status)) return { duplicate: false, winner: false, ignoredOutOfOrder: true };
    await this.store.updateAttempt(attempt.id, { status, errorCode: errorCode ?? attempt.errorCode });
    return { duplicate: false, winner: false };
  }

  private async cancelWithRetry(attempt: CallAttempt, reason: string) {
    if (!attempt.providerCallId) return;
    let lastError: unknown;
    for (let index = 0; index < 3; index += 1) {
      try {
        await this.provider.cancelCall(attempt.providerCallId, `${attempt.roundId}:${attempt.id}:cancel:${reason}`);
        const fresh = await this.store.getAttempt(attempt.id);
        if (fresh && canTransition(fresh.status, 'cancelled')) await this.store.updateAttempt(attempt.id, { status: 'cancelled' });
        this.metrics.cancelled += 1;
        return;
      } catch (error) {
        lastError = error;
        if (index < 2) await this.sleep(10 * 2 ** index);
      }
    }
    await this.store.updateAttempt(attempt.id, { errorCode: lastError instanceof Error ? lastError.message : 'CANCEL_FAILED' });
    this.metrics.failed += 1;
  }
}
