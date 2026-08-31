export const runtime = 'edge';
export async function POST() {
  const seller = process.env.SELLER_DESTINATION;
  if (!seller) return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR">O atendimento não está disponível.</Say><Hangup/></Response>', { status: 503, headers: { 'Content-Type': 'text/xml' } });
  const target = escapeXml(seller);
  const noun = seller.startsWith('sip:') ? `<Sip>${target}</Sip>` : `<Number>${target}</Number>`;
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true" timeout="20">${noun}</Dial></Response>`, { headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } });
}
function escapeXml(value: string) { return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!); }
