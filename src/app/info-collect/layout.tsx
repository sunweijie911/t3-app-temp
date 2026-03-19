import { ModuleLayout } from '@/shared/components/layout/module-layout';

export default function InfoCollectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleLayout
      footerSubtitle="请确保提交信息的准确性"
      footerTitle="信息采集平台"
    >
      {children}
    </ModuleLayout>
  );
}
