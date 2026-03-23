import { redirect } from 'next/navigation';
import { AdminShell } from '@/app/admin/admin-shell';
import { AdminAntdProvider } from '@/app/admin/antd-provider';
import { getSession } from '@/server/better-auth/server';
import { isAdminEmail } from '@/server/services/admin-check';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  if (!isAdminEmail(session.user.email)) {
    redirect('/');
  }

  return (
    <AdminAntdProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAntdProvider>
  );
}
