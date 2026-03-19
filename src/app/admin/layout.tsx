import { redirect } from 'next/navigation';
import { AdminShell } from '@/app/admin/admin-shell';
import { AdminAntdProvider } from '@/app/admin/antd-provider';
import { getSession } from '@/server/better-auth/server';
import { getUserPhone } from '@/server/better-auth/types';
import { isAdminPhone } from '@/server/services/admin-check';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  const phone = getUserPhone(session.user);
  if (!isAdminPhone(phone)) {
    redirect('/');
  }

  return (
    <AdminAntdProvider>
      <AdminShell>{children}</AdminShell>
    </AdminAntdProvider>
  );
}
