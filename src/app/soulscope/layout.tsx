import { ModuleLayout } from '@/shared/components/layout/module-layout';

export default function SoulscopeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ModuleLayout>{children}</ModuleLayout>;
}
