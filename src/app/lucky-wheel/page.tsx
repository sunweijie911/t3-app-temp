import LuckyWheelHome from '@/modules/lucky-wheel/components/home';
import { MODULE_NAME } from '@/modules/lucky-wheel/constants';

export const metadata = {
  title: MODULE_NAME,
  description: '转一转，好运连连！精彩奖品等你来拿',
};

export default function LuckyWheelPage() {
  return <LuckyWheelHome />;
}
