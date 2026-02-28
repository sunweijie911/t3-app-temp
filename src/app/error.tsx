'use client';

import { Footer } from '@/app/_components/layout/footer';
import { Header } from '@/app/_components/layout/header';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 lg:px-8">
          <h1 className="font-bold text-6xl text-purple-600">出错了</h1>
          <p className="mt-4 text-gray-600 text-lg">
            抱歉，页面加载时遇到了问题
          </p>
          <p className="mt-2 text-gray-400 text-sm">
            请稍后重试，如果问题持续存在请联系我们
          </p>
          <button
            className="mt-8 inline-block rounded-xl bg-purple-600 px-6 py-3 font-medium text-white transition-colors hover:bg-purple-700"
            onClick={reset}
            type="button"
          >
            重试
          </button>
        </div>
      </main>
      <Footer />
    </>
  );
}
