export const runtime = 'edge';
export async function POST() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR">Olá. No momento nosso atendente já está em outra ligação. Agradecemos por atender e pedimos desculpas pelo inconveniente.</Say><Hangup/></Response>', { headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } });
}
