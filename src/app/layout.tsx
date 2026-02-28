import '@unocss/reset/tailwind.css';
import '@/styles/globals.css';

import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { Toaster } from 'sonner';

import { TRPCReactProvider } from '@/trpc/react';

export const metadata: Metadata = {
  title: 'SoulScope - 专业人格测试平台',
  description:
    '探索你的内心世界：MBTI、九型人格、大五人格等10种专业人格测试，专家为你定制深度分析报告',
  icons: [{ rel: 'icon', url: '/favicon.ico' }],
};

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geist.variable}`} lang="zh-CN">
      <body>
        <TRPCReactProvider>{children}</TRPCReactProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
