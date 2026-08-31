import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, canTransition, isTerminal } from '../lib/domain/state-machine.ts';
import { normalizeE164, withinCallingHours } from '../lib/security/request.ts';

test('unitário: valida transições explícitas de estado', () => {
  assert.equal(canTransition('ringing', 'answered'), true);
  assert.equal(canTransition('answered', 'voicemail'), true);
  assert.equal(canTransition('completed', 'ringing'), false);
  assert.throws(() => assertTransition('cancelled', 'winner'), /INVALID_TRANSITION/);
  assert.equal(isTerminal('voicemail'), true);
});

test('unitário: normaliza telefone no padrão E.164 e rejeita entrada inválida', () => {
  assert.equal(normalizeE164('(11) 99876-5432'), '+5511998765432');
  assert.equal(normalizeE164('+1 415 555 2671'), '+14155552671');
  assert.throws(() => normalizeE164('123'), /INVALID_E164/);
});

test('unitário: aplica janela de horário permitida', () => {
  assert.equal(withinCallingHours(new Date(2026, 7, 31, 10, 0)), true);
  assert.equal(withinCallingHours(new Date(2026, 7, 31, 20, 0)), false);
});
