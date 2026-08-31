export const runtime = 'edge';
export async function POST(request: Request) {
  const repeat = new URL('/api/twilio/twiml/wait', request.url).toString();
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR">Um momento, por favor.</Say><Pause length="20"/><Redirect method="POST">${escapeXml(repeat)}</Redirect></Response>`, { headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } });
}
function escapeXml(value: string) { return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!); }
