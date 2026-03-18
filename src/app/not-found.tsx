import Link from 'next/link';
import { Footer } from '@/shared/components/layout/footer';
import { Header } from '@/shared/components/layout/header';

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 lg:px-8">
          <h1 className="font-bold text-6xl text-purple-600">404</h1>
          <p className="mt-4 text-gray-600 text-lg">页面未找到</p>
          <p className="mt-2 text-gray-400 text-sm">
            你访问的页面不存在或已被移除
          </p>
          <Link
            className="mt-8 inline-block rounded-xl bg-purple-600 px-6 py-3 font-medium text-white transition-colors hover:bg-purple-700"
            href="/"
          >
            返回首页
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
