export const runtime = 'edge';
export async function GET() {
  return new Response([
    '# HELP dialer_up Whether the dialer API is serving requests.', '# TYPE dialer_up gauge', 'dialer_up 1',
    '# HELP dialer_build_info Static build information.', '# TYPE dialer_build_info gauge', 'dialer_build_info{provider="' + (process.env.TELEPHONY_PROVIDER ?? 'simulator') + '"} 1', '',
  ].join('\n'), { headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' } });
}
