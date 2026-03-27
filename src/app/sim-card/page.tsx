import SimCardHome from '@/modules/sim-card/components/home';
import { MODULE_NAME } from '@/modules/sim-card/constants';

export const metadata = {
  title: MODULE_NAME,
  description: '电话卡套餐在线办理',
};

export default function SimCardPage() {
  return <SimCardHome />;
}
