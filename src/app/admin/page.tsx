import { redirect } from 'next/navigation';
import { getDefaultModuleId } from '@/server/services/config';

export const metadata = {
  title: '管理后台',
};

export default async function AdminPage() {
  const defaultModuleId = await getDefaultModuleId();
  redirect(`/admin/${defaultModuleId}`);
}
