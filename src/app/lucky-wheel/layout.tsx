import { MODULE_NAME } from '@/modules/lucky-wheel/constants';
import { ModuleLayout } from '@/shared/components/layout/module-layout';

export default function LuckyWheelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleLayout
      footerSubtitle="活动最终解释权归主办方所有"
      footerTitle={MODULE_NAME}
    >
      {children}
    </ModuleLayout>
  );
}
