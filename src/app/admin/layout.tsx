import { redirect } from 'next/navigation';
import { env } from '@/env';
import { getSession } from '@/server/better-auth/server';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  const adminEmails = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (!adminEmails.includes(session.user.email)) {
    redirect('/');
  }

  return <>{children}</>;
}
