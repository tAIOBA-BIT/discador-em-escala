import type { StartCallInput, TelephonyProvider } from '../domain/types.ts';

export type SimulatorAction = {
  type: 'start' | 'cancel' | 'connect' | 'goodbye';
  providerCallId: string;
  idempotencyKey?: string;
};

export class SimulatorProvider implements TelephonyProvider {
  readonly name = 'simulator';
  readonly actions: SimulatorAction[] = [];
  readonly cancelAttempts = new Map<string, number>();
  private failCancelOnce = new Set<string>();

  setTemporaryCancelFailure(providerCallId: string) {
    this.failCancelOnce.add(providerCallId);
  }

  async startCall(input: StartCallInput) {
    const providerCallId = `SIM-${input.attemptId}`;
    this.actions.push({ type: 'start', providerCallId, idempotencyKey: input.idempotencyKey });
    return { providerCallId };
  }

  async cancelCall(providerCallId: string, idempotencyKey: string) {
    const count = (this.cancelAttempts.get(providerCallId) ?? 0) + 1;
    this.cancelAttempts.set(providerCallId, count);
    if (this.failCancelOnce.delete(providerCallId)) throw new Error('SIMULATED_TEMPORARY_PROVIDER_FAILURE');
    this.actions.push({ type: 'cancel', providerCallId, idempotencyKey });
  }

  async getCall(providerCallId: string) {
    const cancelled = this.actions.some((action) => action.type === 'cancel' && action.providerCallId === providerCallId);
    return { status: cancelled ? 'cancelled' : 'in-progress' };
  }

  async connectToSeller(providerCallId: string, idempotencyKey: string) {
    this.actions.push({ type: 'connect', providerCallId, idempotencyKey });
  }

  async playLateAnswerMessage(providerCallId: string) {
    this.actions.push({ type: 'goodbye', providerCallId });
  }

  async validateWebhook(_url: string, _params: URLSearchParams, signature: string) {
    return signature === 'simulator-valid-signature';
  }
}
