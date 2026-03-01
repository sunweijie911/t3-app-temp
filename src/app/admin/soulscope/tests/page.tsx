import Link from 'next/link';
import { Header } from '@/app/_components/layout/header';
import { api, HydrateClient } from '@/trpc/server';

export default async function AdminTestsPage() {
  const tests = await api.soulscope.test.list();

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <Link
                className="text-purple-600 text-sm hover:text-purple-700"
                href="/admin/soulscope"
              >
                &larr; 返回 SoulScope 管理
              </Link>
              <h1 className="mt-2 font-bold text-3xl text-gray-900">
                测试管理
              </h1>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    名称
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    题数
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    价格
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tests.map((test) => (
                  <tr key={test.id}>
                    <td className="whitespace-nowrap px-6 py-4 font-medium text-gray-900">
                      {test.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {test.questionCount}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      &yen;{test.reportPrice}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {test.isFeatured && (
                        <span className="mr-2 rounded-full bg-purple-100 px-2 py-1 text-purple-700 text-xs">
                          热门
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <Link
                        className="text-purple-600 text-sm hover:text-purple-700"
                        href={`/admin/soulscope/tests/${test.id}/questions`}
                      >
                        管理题目
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </HydrateClient>
  );
}
