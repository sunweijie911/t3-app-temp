import { MODULE_NAME } from '@/modules/info-collect/constants';
import { ModuleLayout } from '@/shared/components/layout/module-layout';

export default function InfoCollectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleLayout
      footerSubtitle="请确保提交信息的准确性"
      footerTitle={`${MODULE_NAME}平台`}
    >
      {children}
    </ModuleLayout>
  );
}
