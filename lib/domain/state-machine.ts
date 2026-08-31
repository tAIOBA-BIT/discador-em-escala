import type { AttemptState } from './types.ts';

const transitions: Record<AttemptState, ReadonlySet<AttemptState>> = {
  queued: new Set(['starting', 'cancelled', 'failed']),
  starting: new Set(['ringing', 'answered', 'busy', 'no_answer', 'failed', 'cancelled']),
  ringing: new Set(['answered', 'busy', 'no_answer', 'failed', 'cancelled']),
  answered: new Set(['human_confirmed', 'voicemail', 'failed', 'cancelled']),
  human_confirmed: new Set(['winner', 'cancelled']),
  winner: new Set(['connected', 'failed']),
  connected: new Set(['completed', 'failed']),
  cancelled: new Set(),
  busy: new Set(),
  no_answer: new Set(),
  voicemail: new Set(),
  failed: new Set(),
  completed: new Set(),
};

export function canTransition(from: AttemptState, to: AttemptState): boolean {
  return from === to || transitions[from].has(to);
}

export function assertTransition(from: AttemptState, to: AttemptState): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_TRANSITION:${from}->${to}`);
  }
}

export function isTerminal(state: AttemptState): boolean {
  return ['cancelled', 'busy', 'no_answer', 'voicemail', 'failed', 'completed'].includes(state);
}

export function isCancellable(state: AttemptState): boolean {
  return ['queued', 'starting', 'ringing', 'answered', 'human_confirmed'].includes(state);
}
