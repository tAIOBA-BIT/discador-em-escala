import type { StartCallInput, TelephonyProvider } from '../domain/types.ts';

export type TwilioConfig = { accountSid: string; authToken: string; fromNumber: string; statusCallbackUrl: string; screeningTwimlUrl: string; bridgeTwimlUrl: string };

export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  private readonly baseUrl: string;
  private readonly config: TwilioConfig;
  private readonly request: typeof fetch;

  constructor(config: TwilioConfig, request: typeof fetch = fetch) {
    this.config = config;
    this.request = request;
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}`;
  }

  async startCall(input: StartCallInput) {
    const form = new URLSearchParams({ To: input.to, From: this.config.fromNumber, Url: this.config.screeningTwimlUrl, StatusCallback: this.config.statusCallbackUrl,
      StatusCallbackEvent: 'initiated ringing answered completed', MachineDetection: 'Enable', AsyncAmd: 'true', AsyncAmdStatusCallback: this.config.statusCallbackUrl, AsyncAmdStatusCallbackMethod: 'POST' });
    const response = await this.api('/Calls.json', { method: 'POST', body: form, headers: { 'Idempotency-Key': input.idempotencyKey } });
    const body = await response.json() as { sid?: string };
    if (!body.sid) throw new Error('TWILIO_CALL_SID_MISSING');
    return { providerCallId: body.sid };
  }

  async cancelCall(providerCallId: string, idempotencyKey: string) {
    await this.api(`/Calls/${providerCallId}.json`, { method: 'POST', body: new URLSearchParams({ Status: 'completed' }), headers: { 'Idempotency-Key': idempotencyKey } });
  }

  async getCall(providerCallId: string) {
    const response = await this.api(`/Calls/${providerCallId}.json`);
    const body = await response.json() as { status?: string };
    return { status: body.status ?? 'unknown' };
  }

  async connectToSeller(providerCallId: string, idempotencyKey: string) {
    await this.api(`/Calls/${providerCallId}.json`, { method: 'POST', body: new URLSearchParams({ Url: this.config.bridgeTwimlUrl, Method: 'POST' }), headers: { 'Idempotency-Key': idempotencyKey } });
  }

  async playLateAnswerMessage(providerCallId: string) {
    const url = new URL(this.config.bridgeTwimlUrl); url.pathname = '/api/twilio/twiml/late-answer';
    await this.api(`/Calls/${providerCallId}.json`, { method: 'POST', body: new URLSearchParams({ Url: url.toString(), Method: 'POST' }) });
  }

  async validateWebhook(url: string, params: URLSearchParams, signature: string) {
    const payload = url + [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}${value}`).join('');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.config.authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return constantTimeEqual(bytesToBase64(new Uint8Array(digest)), signature);
  }

  private async api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Basic ${bytesToBase64(new TextEncoder().encode(`${this.config.accountSid}:${this.config.authToken}`))}`);
    if (init.body) headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const response = await this.request(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(`TWILIO_HTTP_${response.status}`);
    return response;
  }
}

function bytesToBase64(bytes: Uint8Array) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let mismatch = 0; for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index); return mismatch === 0; }
