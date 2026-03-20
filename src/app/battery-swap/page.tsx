import BatterySwapHome from '@/modules/battery-swap/components/home';
import { MODULE_NAME } from '@/modules/battery-swap/constants';

export const metadata = {
  title: MODULE_NAME,
  description: '多家品牌换电方案，一站对比选购',
};

export default function BatterySwapPage() {
  return <BatterySwapHome />;
}
