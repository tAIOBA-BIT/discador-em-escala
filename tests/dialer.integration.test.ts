import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DialerService } from '../lib/domain/dialer-service.ts';
import { MemoryDialStore } from '../lib/domain/memory-store.ts';
import type { Contact, ProviderEvent } from '../lib/domain/types.ts';
import { SimulatorProvider } from '../lib/telephony/simulator-provider.ts';
import { TwilioProvider } from '../lib/telephony/twilio-provider.ts';

const contacts = (count: number): Contact[] => Array.from({ length: count }, (_, index) => ({ id: `c${index + 1}`, name: `Contato ${index + 1}`, phoneE164: `+551199999${String(index).padStart(4, '0')}` }));
const setup = async (count = 3, suffix = crypto.randomUUID()) => {
  const store = new MemoryDialStore(); const provider = new SimulatorProvider(); const service = new DialerService(store, provider, async () => {});
  const started = await service.startRound({ roundId: `r-${suffix}`, idempotencyKey: `key-${suffix}`, contacts: contacts(count), concurrency: count });
  return { store, provider, service, attempts: started.attempts, roundId: started.round.id };
};
const human = (attemptId: string, id = crypto.randomUUID()): ProviderEvent => ({ id, attemptId, type: 'answered', classification: 'human', occurredAt: Date.now() });

test('integração: duas pessoas atendem simultaneamente e somente uma vence', async () => {
  const { service, store, attempts, roundId } = await setup(4);
  const results = await Promise.all(attempts.slice(0, 2).map((attempt) => service.handleEvent(human(attempt.id))));
  assert.equal(results.filter((result) => result.winner).length, 1);
  const round = await store.getRound(roundId); assert.ok(round?.winnerAttemptId);
  assert.equal((await store.listAttempts(roundId)).filter((attempt) => attempt.status === 'connected').length, 1);
});

test('integração: webhook vencedor duplicado é idempotente', async () => {
  const { service, provider, attempts } = await setup(3); const event = human(attempts[0].id, 'evt-repeat');
  const first = await service.handleEvent(event); const actionCount = provider.actions.length; const second = await service.handleEvent(event);
  assert.equal(first.winner, true); assert.equal(second.duplicate, true); assert.equal(provider.actions.length, actionCount);
});

test('integração: evento fora de ordem não regride tentativa concluída', async () => {
  const { service, store, attempts, roundId } = await setup(2);
  await service.handleEvent(human(attempts[0].id)); await service.finishConversation(roundId);
  const late = await service.handleEvent({ id: 'late-ringing', attemptId: attempts[0].id, type: 'ringing' });
  assert.equal(late.ignoredOutOfOrder, true); assert.equal((await store.getAttempt(attempts[0].id))?.status, 'completed');
});

test('integração: caixa postal antes de pessoa não é tratada como sucesso', async () => {
  const { service, store, attempts, roundId } = await setup(3);
  const machine = await service.handleEvent({ id: 'machine', attemptId: attempts[0].id, type: 'answered', classification: 'machine' });
  assert.equal(machine.winner, false); assert.equal((await store.getAttempt(attempts[0].id))?.status, 'voicemail');
  const person = await service.handleEvent(human(attempts[1].id)); assert.equal(person.winner, true); assert.equal((await store.getRound(roundId))?.winnerAttemptId, attempts[1].id);
});

test('integração: resultado inconclusivo aguarda classificação explícita', async () => {
  const { service, store, attempts } = await setup(2);
  const result = await service.handleEvent({ id: 'unknown', attemptId: attempts[0].id, type: 'answered', classification: 'unknown' });
  assert.equal(result.winner, false); assert.equal((await store.getAttempt(attempts[0].id))?.status, 'answered');
});

test('integração: falha de uma chamada não impede outra vencedora', async () => {
  const { service, store, attempts } = await setup(3);
  await service.handleEvent({ id: 'failure', attemptId: attempts[0].id, type: 'failed', errorCode: 'carrier_rejected' });
  assert.equal((await store.getAttempt(attempts[0].id))?.status, 'failed'); assert.equal((await service.handleEvent(human(attempts[1].id))).winner, true);
});

test('integração: cancelamento com falha temporária usa backoff seguro', async () => {
  const { service, provider, attempts, store } = await setup(3); const target = attempts[1].providerCallId!; provider.setTemporaryCancelFailure(target);
  await service.handleEvent(human(attempts[0].id));
  assert.equal(provider.cancelAttempts.get(target), 2); assert.equal((await store.getAttempt(attempts[1].id))?.status, 'cancelled');
});

test('integração: vendedor indisponível impede conexão e reproduz despedida', async () => {
  const { service, provider, attempts, store } = await setup(2); store.sellerAvailable = false;
  const result = await service.handleEvent(human(attempts[0].id));
  assert.equal(result.winner, false); assert.equal(result.reason, 'seller_unavailable'); assert.equal(provider.actions.filter((action) => action.type === 'goodbye').length, 1);
});

test('integração: reinício do servidor preserva rodada no armazenamento', async () => {
  const { provider, attempts, store, roundId } = await setup(3); const restarted = new DialerService(store, provider, async () => {});
  assert.equal((await restarted.handleEvent(human(attempts[2].id))).winner, true); assert.equal((await store.getRound(roundId))?.winnerAttemptId, attempts[2].id);
});

test('integração: comando de início repetido não gera segunda ligação', async () => {
  const store = new MemoryDialStore(); const provider = new SimulatorProvider(); const service = new DialerService(store, provider, async () => {}); const list = contacts(3);
  await service.startRound({ roundId: 'r-idem-1', idempotencyKey: 'same-key', contacts: list, concurrency: 3 });
  const again = await service.startRound({ roundId: 'r-idem-2', idempotencyKey: 'same-key', contacts: list, concurrency: 3 });
  assert.equal(again.created, false); assert.equal(provider.actions.filter((action) => action.type === 'start').length, 3);
});

test('integração: contato da lista não ligar é bloqueado antes da operadora', async () => {
  const store = new MemoryDialStore(); const provider = new SimulatorProvider(); const service = new DialerService(store, provider);
  await assert.rejects(service.startRound({ roundId: 'r-dnc', idempotencyKey: 'key-dnc', contacts: [{ ...contacts(1)[0], doNotCall: true }], concurrency: 1 }), /DO_NOT_CALL/);
  assert.equal(provider.actions.length, 0);
});

test('integração: limite de concorrência é exatamente 10', async () => {
  const exact = await setup(10); assert.equal(exact.provider.actions.filter((action) => action.type === 'start').length, 10);
  const store = new MemoryDialStore(); const provider = new SimulatorProvider(); const service = new DialerService(store, provider);
  await assert.rejects(service.startRound({ roundId: 'r-11', idempotencyKey: 'key-11', contacts: contacts(11), concurrency: 11 }), /INVALID_CONCURRENCY/);
});

test('integração: webhook sem assinatura válida é rejeitável', async () => {
  const provider = new TwilioProvider({ accountSid: 'AC-test', authToken: 'test-token', fromNumber: '+551100000000', statusCallbackUrl: 'https://example.test/hook', screeningTwimlUrl: 'https://example.test/wait', bridgeTwimlUrl: 'https://example.test/bridge' });
  assert.equal(await provider.validateWebhook('https://example.test/hook', new URLSearchParams({ CallSid: 'CA-test' }), 'assinatura-inválida'), false);
});

test('integração: nenhuma nova rodada começa enquanto vendedor está ocupado', async () => {
  const { service, attempts } = await setup(2); await service.handleEvent(human(attempts[0].id));
  await assert.rejects(service.startRound({ roundId: 'r-next', idempotencyKey: 'next', contacts: contacts(2), concurrency: 2 }), /SELLER_BUSY/);
});

test('concorrência: cinquenta eventos paralelos produzem uma única vencedora', async () => {
  const { service, store, attempts, roundId } = await setup(10);
  const results = await Promise.all(Array.from({ length: 50 }, (_, index) => service.handleEvent(human(attempts[index % attempts.length].id, `parallel-${index}`))));
  assert.equal(results.filter((result) => result.winner).length, 1); assert.equal((await store.listAttempts(roundId)).filter((attempt) => attempt.status === 'connected').length, 1);
});

test('banco: migração aplica e compare-and-set aceita somente um vencedor', () => {
  const database = new DatabaseSync(':memory:'); const migration = readFileSync(new URL('../migrations/0000_initial.sql', import.meta.url), 'utf8'); database.exec(migration);
  const now = Date.now();
  database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run('u1', 'ext1', 'seller@example.test', 'Seller', 'available', now, now);
  database.prepare('INSERT INTO campaigns VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('camp1', 'u1', 'Campaign', 'running', 10, 'campaign-key', now, now);
  database.prepare('INSERT INTO dial_rounds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('round1', 'camp1', 'dialing', null, 'round-key', now, null, now, now);
  const claim = database.prepare("UPDATE dial_rounds SET winner_attempt_id = ?, status = 'winner_locked' WHERE id = ? AND winner_attempt_id IS NULL");
  assert.equal(claim.run('attempt-1', 'round1').changes, 1); assert.equal(claim.run('attempt-2', 'round1').changes, 0);
  assert.equal((database.prepare('SELECT winner_attempt_id AS winner FROM dial_rounds WHERE id = ?').get('round1') as { winner: string }).winner, 'attempt-1');
  assert.equal((database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok'); database.close();
});
