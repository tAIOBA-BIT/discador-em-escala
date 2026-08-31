type Fields = Record<string, unknown>;
export function log(level: 'info' | 'warn' | 'error', message: string, fields: Fields = {}) {
  const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => !/(phone|token|secret|password|payload)/i.test(key)));
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...safe }));
}
