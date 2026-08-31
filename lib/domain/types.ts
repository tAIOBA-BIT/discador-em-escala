export const ATTEMPT_STATES = [
  'queued',
  'starting',
  'ringing',
  'answered',
  'human_confirmed',
  'winner',
  'connected',
  'cancelled',
  'busy',
  'no_answer',
  'voicemail',
  'failed',
  'completed',
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];
export type AnswerClassification = 'human' | 'machine' | 'unknown';

export type Contact = {
  id: string;
  name: string;
  phoneE164: string;
  doNotCall?: boolean;
  attemptsInWindow?: number;
  lastAttemptAt?: number | null;
};

export type CallAttempt = {
  id: string;
  roundId: string;
  contactId: string;
  contactName: string;
  phoneE164: string;
  status: AttemptState;
  providerCallId: string | null;
  classification: AnswerClassification | null;
  errorCode: string | null;
};

export type DialRound = {
  id: string;
  idempotencyKey: string;
  status: 'starting' | 'dialing' | 'winner_locked' | 'completed' | 'cancelled';
  winnerAttemptId: string | null;
  concurrency: number;
};

export type ProviderEvent = {
  id: string;
  attemptId: string;
  type: 'ringing' | 'answered' | 'busy' | 'no_answer' | 'failed' | 'completed';
  classification?: AnswerClassification;
  errorCode?: string;
  occurredAt?: number;
};

export type StartRoundInput = {
  roundId: string;
  idempotencyKey: string;
  contacts: Contact[];
  concurrency: number;
  now?: number;
};

export type StartCallInput = {
  attemptId: string;
  to: string;
  idempotencyKey: string;
  roundId: string;
};

export interface TelephonyProvider {
  readonly name: string;
  startCall(input: StartCallInput): Promise<{ providerCallId: string }>;
  cancelCall(providerCallId: string, idempotencyKey: string): Promise<void>;
  getCall(providerCallId: string): Promise<{ status: string }>;
  connectToSeller(providerCallId: string, idempotencyKey: string): Promise<void>;
  playLateAnswerMessage(providerCallId: string): Promise<void>;
  validateWebhook(url: string, params: URLSearchParams, signature: string): Promise<boolean>;
}

export interface DialStore {
  sellerAvailable: boolean;
  sellerBusy: boolean;
  createRound(round: DialRound, attempts: CallAttempt[]): Promise<{ round: DialRound; attempts: CallAttempt[]; created: boolean }>;
  getRound(roundId: string): Promise<DialRound | null>;
  getAttempt(attemptId: string): Promise<CallAttempt | null>;
  listAttempts(roundId: string): Promise<CallAttempt[]>;
  updateAttempt(attemptId: string, patch: Partial<CallAttempt>): Promise<CallAttempt>;
  tryClaimWinner(roundId: string, attemptId: string): Promise<boolean>;
  recordEvent(event: ProviderEvent): Promise<boolean>;
}
