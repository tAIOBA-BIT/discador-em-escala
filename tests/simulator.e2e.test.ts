import test from 'node:test';
import assert from 'node:assert/strict';
import { DialerService } from '../lib/domain/dialer-service.ts';
import { MemoryDialStore } from '../lib/domain/memory-store.ts';
import { SimulatorProvider } from '../lib/telephony/simulator-provider.ts';

test('fluxo completo: uma pessoa atende e as outras nove são canceladas', async () => {
  const store = new MemoryDialStore(); const provider = new SimulatorProvider(); const service = new DialerService(store, provider, async () => {});
  const contacts = Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, name: `Contato ${index + 1}`, phoneE164: `+551198880${String(index).padStart(4, '0')}` }));
  const started = await service.startRound({ roundId: 'round-e2e-10', idempotencyKey: 'e2e-10', contacts, concurrency: 10 });
  const result = await service.handleEvent({ id: 'answer-e2e', attemptId: started.attempts[4].id, type: 'answered', classification: 'human', occurredAt: Date.now() });
  const final = await store.listAttempts('round-e2e-10');
  assert.equal(result.winner, true); assert.equal(final.filter((attempt) => attempt.status === 'connected').length, 1);
  assert.equal(final.filter((attempt) => attempt.status === 'cancelled').length, 9);
  assert.equal(provider.actions.filter((action) => action.type === 'cancel').length, 9);
  assert.equal(provider.actions.filter((action) => action.type === 'connect').length, 1);
});
