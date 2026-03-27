import '@unocss/reset/tailwind.css';
import '@/styles/globals.css';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { getDefaultModuleId } from '@/server/services/config';
import { DefaultModuleProvider } from '@/shared/components/default-module-provider';
import { TRPCReactProvider } from '@/trpc/react';

export const metadata: Metadata = {
  title: '管理平台',
  description: '多模块管理平台',
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const defaultModuleId = await getDefaultModuleId();

  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <TRPCReactProvider>
            <DefaultModuleProvider moduleId={defaultModuleId}>
              {children}
            </DefaultModuleProvider>
          </TRPCReactProvider>
        </AntdRegistry>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
