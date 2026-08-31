export const runtime = 'edge';
export async function GET() {
  return Response.json({ status: 'ok', service: 'linha-um-dialer', telephony: process.env.TELEPHONY_PROVIDER ?? 'simulator', timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
