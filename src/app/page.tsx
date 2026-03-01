import { getDefaultModuleId } from '@/server/services/config';

/** Server-only mapping – keeps heavy module imports out of the client bundle. */
const homeComponents: Record<
  string,
  () => Promise<{ default: React.ComponentType }>
> = {
  'lucky-wheel': () => import('@/modules/lucky-wheel/components/home'),
  soulscope: () => import('@/modules/soulscope/components/home'),
};

export default async function Home() {
  const id = await getDefaultModuleId();
  const loader = homeComponents[id];
  if (!loader) throw new Error(`Unknown module: ${id}`);
  const { default: HomeComponent } = await loader();
  return <HomeComponent />;
}
