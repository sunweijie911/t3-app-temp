import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MyRecordsSheet } from '@/modules/lucky-wheel/components/record/my-records';
import { WheelContainer } from '@/modules/lucky-wheel/components/wheel/wheel-container';
import { api, HydrateClient } from '@/trpc/server';

interface Props {
  params: Promise<{ slug: string }>;
}

async function getActivity(slug: string) {
  try {
    return await api.luckyWheel.activity.getBySlug({ slug });
  } catch {
    notFound();
  }
}

export default async function WheelPage({ params }: Props) {
  const { slug } = await params;
  const activity = await getActivity(slug);

  return (
    <HydrateClient>
      <main
        className="relative min-h-screen"
        style={{
          background:
            'linear-gradient(180deg, #FF6B3D 0%, #FF8F5E 40%, #FFA978 100%)',
        }}
      >
        {/* Back arrow */}
        <Link
          aria-label="返回"
          className="absolute top-4 left-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm"
          href="/"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="18"
            viewBox="0 0 24 24"
            width="18"
          >
            <path
              d="M15 18L9 12L15 6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </Link>

        <div className="mx-auto max-w-2xl px-4 pt-16 pb-12">
          <h1 className="mb-2 text-center font-bold text-3xl text-white">
            {activity.name}
          </h1>
          {activity.description && (
            <p className="mb-8 text-center text-white/80">
              {activity.description}
            </p>
          )}

          <WheelContainer activityId={activity.id} prizes={activity.prizes} />

          {/* Rules — frosted glass card, always shown */}
          <div
            className="mt-10 rounded-[30px] p-6"
            style={{
              backdropFilter: 'blur(30px)',
              WebkitBackdropFilter: 'blur(30px)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,1) 56%)',
            }}
          >
            <h3 className="mb-3 font-semibold text-gray-900">活动规则</h3>
            <ul className="list-inside list-disc space-y-1 text-gray-500 text-sm">
              {activity.maxDrawsPerUser > 0 && (
                <li>每人最多抽奖 {activity.maxDrawsPerUser} 次</li>
              )}
              {activity.maxDrawsPerDay > 0 && (
                <li>每人每天最多抽奖 {activity.maxDrawsPerDay} 次</li>
              )}
              {activity.endAt && (
                <li>
                  活动截止：
                  {new Date(activity.endAt).toLocaleDateString()}
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* My records bottom sheet */}
        <MyRecordsSheet />
      </main>
    </HydrateClient>
  );
}
