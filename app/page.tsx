import { getChatGPTUser } from './chatgpt-auth';
import { DialerDashboard } from './dialer-dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  return <DialerDashboard displayName={user?.displayName ?? 'Operador local'} authenticated={Boolean(user)} />;
}
