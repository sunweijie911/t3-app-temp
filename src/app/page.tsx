import { redirect } from 'next/navigation';
import { getModule } from '@/modules/registry';
import { getDefaultModuleId } from '@/server/services/config';

export default async function Home() {
  const id = await getDefaultModuleId();
  const mod = getModule(id);
  redirect(mod.basePath);
}
