import { ModuleLayout } from '@/shared/components/layout/module-layout';

export default function LuckyWheelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleLayout
      footerSubtitle="活动最终解释权归主办方所有"
      footerTitle="幸运大转盘"
    >
      {children}
    </ModuleLayout>
  );
}
