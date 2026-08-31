export function authorizeMutation(request: Request): { userId: string; email: string } | null {
  const url = new URL(request.url); const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return null;
  const userId = request.headers.get('oai-authenticated-user-id'); const email = request.headers.get('oai-authenticated-user-email');
  if (userId && email) return { userId, email };
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return { userId: 'local-simulator', email: 'simulador@local' };
  return null;
}

export function normalizeE164(value: string, defaultCountryCode = '55'): string {
  const digits = value.replace(/\D/g, ''); const withCountry = value.trim().startsWith('+') ? digits : `${defaultCountryCode}${digits}`;
  if (withCountry.length < 10 || withCountry.length > 15) throw new Error('INVALID_E164');
  return `+${withCountry}`;
}

export function withinCallingHours(now: Date, startHour = 9, endHour = 18) { const hour = now.getHours(); return hour >= startHour && hour < endHour; }
