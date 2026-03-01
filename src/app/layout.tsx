import '@unocss/reset/tailwind.css';
import '@/styles/globals.css';

import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { Toaster } from 'sonner';

import { DefaultModuleProvider } from '@/app/_components/default-module-provider';
import { getModule } from '@/modules/registry';
import { getDefaultModuleId } from '@/server/services/config';
import { TRPCReactProvider } from '@/trpc/react';

export async function generateMetadata(): Promise<Metadata> {
  const moduleId = await getDefaultModuleId();
  const mod = getModule(moduleId);
  return {
    title: `${mod.name} - ${mod.description}`,
    description: mod.description,
    icons: [{ rel: 'icon', url: '/favicon.ico' }],
  };
}

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const defaultModuleId = await getDefaultModuleId();

  return (
    <html className={`${geist.variable}`} lang="zh-CN">
      <body>
        <TRPCReactProvider>
          <DefaultModuleProvider moduleId={defaultModuleId}>
            {children}
          </DefaultModuleProvider>
        </TRPCReactProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
