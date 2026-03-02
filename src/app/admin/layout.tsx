import { redirect } from 'next/navigation';
import { AdminAntdProvider } from '@/app/admin/antd-provider';
import { getSession } from '@/server/better-auth/server';
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

  const phone = (session.user as { phoneNumber?: string | null }).phoneNumber;
  if (!isAdminPhone(phone)) {
    redirect('/');
  }

  return <AdminAntdProvider>{children}</AdminAntdProvider>;
}
