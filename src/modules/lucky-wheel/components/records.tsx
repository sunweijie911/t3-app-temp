import Link from 'next/link';
import { MyRecords } from '@/modules/lucky-wheel/components/record/my-records';
import { MODULE_NAME } from '@/modules/lucky-wheel/constants';
import { HydrateClient } from '@/trpc/server';

export const metadata = {
  title: `我的抽奖记录 - ${MODULE_NAME}`,
};

export default function RecordsPage() {
  return (
    <HydrateClient>
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-2xl px-4 py-12">
          <div className="mb-8">
            <Link
              className="text-orange-600 text-sm hover:text-orange-700"
              href="/lucky-wheel"
            >
              &larr; 返回大转盘
            </Link>
            <h1 className="mt-2 font-bold text-3xl text-gray-900">
              我的抽奖记录
            </h1>
          </div>
          <MyRecords />
        </div>
      </main>
    </HydrateClient>
  );
}
