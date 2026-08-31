import { DialerService } from '@/lib/domain/dialer-service.ts';
import { MemoryDialStore } from '@/lib/domain/memory-store.ts';
import type { Contact } from '@/lib/domain/types.ts';
import { authorizeMutation, normalizeE164 } from '@/lib/security/request.ts';
import { SimulatorProvider } from '@/lib/telephony/simulator-provider.ts';

export const runtime = 'edge';

type SimulationRequest = { concurrency?: number; contacts?: Array<{ id: string; name: string; phone: string; doNotCall?: boolean }> };

export async function POST(request: Request) {
  if (!authorizeMutation(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body: SimulationRequest;
  try { body = await request.json() as SimulationRequest; } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
  const concurrency = Number(body.concurrency ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) return Response.json({ error: 'concurrency_must_be_1_to_10' }, { status: 422 });
  if (!Array.isArray(body.contacts) || body.contacts.length === 0 || body.contacts.length > 100) return Response.json({ error: 'contacts_must_contain_1_to_100_items' }, { status: 422 });

  let contacts: Contact[];
  try {
    contacts = body.contacts.map((contact) => ({ id: String(contact.id).slice(0, 80), name: String(contact.name).slice(0, 120), phoneE164: normalizeE164(String(contact.phone)), doNotCall: Boolean(contact.doNotCall) }));
  } catch { return Response.json({ error: 'invalid_phone_number' }, { status: 422 }); }
  if (contacts.some((contact) => contact.doNotCall)) return Response.json({ error: 'do_not_call_contact_selected' }, { status: 409 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      void (async () => {
        try {
          const store = new MemoryDialStore(); const provider = new SimulatorProvider(); const dialer = new DialerService(store, provider, wait);
          const roundId = `round-${crypto.randomUUID()}`;
          const started = await dialer.startRound({ roundId, idempotencyKey: request.headers.get('idempotency-key') ?? crypto.randomUUID(), contacts, concurrency });
          send('round', { roundId, status: 'dialing', attempts: started.attempts.map(({ id, contactId, contactName, status }) => ({ id, contactId, contactName, status })) });
          for (const attempt of started.attempts) { if (request.signal.aborted) throw new Error('CLIENT_ABORTED'); send('attempt', { id: attempt.id, status: 'ringing' }); await wait(90); }
          await wait(420);
          const winner = started.attempts[Math.min(2, started.attempts.length - 1)];
          send('attempt', { id: winner.id, status: 'answered' }); await wait(180);
          const result = await dialer.handleEvent({ id: `evt-${crypto.randomUUID()}`, attemptId: winner.id, type: 'answered', classification: 'human', occurredAt: Date.now() });
          if (!result.winnerAttemptId) throw new Error('SIMULATOR_WINNER_MISSING');
          const finalAttempts = await store.listAttempts(roundId);
          for (const attempt of finalAttempts) send('attempt', { id: attempt.id, status: attempt.status, winner: attempt.id === result.winnerAttemptId });
          send('connected', { winnerAttemptId: result.winnerAttemptId, metrics: dialer.metrics, cancellationCommands: provider.actions.filter((action) => action.type === 'cancel').length });
          send('done', { ok: true }); controller.close();
        } catch (error) {
          if (!request.signal.aborted) send('error', { message: error instanceof Error ? error.message : 'simulation_failed' });
          controller.close();
        }
      })();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
}
