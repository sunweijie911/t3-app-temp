import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRIZE_TYPE_LABELS } from '@/modules/lucky-wheel/constants';
import { getSession } from '@/server/better-auth/server';
import { api, HydrateClient } from '@/trpc/server';
import { WheelSection } from './wheel-section';

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
  const [session, activity] = await Promise.all([
    getSession(),
    getActivity(slug),
  ]);

  const isLoggedIn = !!session?.user;

  const now = new Date();
  const notStarted = activity.startAt && now < new Date(activity.startAt);
  const ended = activity.endAt && now > new Date(activity.endAt);

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
          <h1
            className="mb-8 text-center font-extrabold text-3xl text-white"
            style={{
              textShadow:
                '0 2px 8px rgba(0,0,0,0.15), 0 0 20px rgba(255,255,255,0.2)',
            }}
          >
            {activity.name}
          </h1>

          {notStarted ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="text-5xl">⏳</div>
              <p className="font-semibold text-white text-xl">活动尚未开始</p>
              <p className="text-white/80">
                预计开始时间：
                {activity.startAt
                  ? new Date(activity.startAt).toLocaleString('zh-CN')
                  : '未定'}
              </p>
            </div>
          ) : ended ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="text-5xl">🎉</div>
              <p className="font-semibold text-white text-xl">活动已结束</p>
              <p className="text-white/80">感谢您的参与！</p>
            </div>
          ) : (
            <WheelSection
              activityId={activity.id}
              initialLoggedIn={isLoggedIn}
              prizes={activity.prizes}
            />
          )}

          {/* 活动规则 — 毛玻璃卡片 + 装饰性标题 */}
          <div
            className="mt-10 rounded-[30px] p-6"
            style={{
              backdropFilter: 'blur(30px)',
              WebkitBackdropFilter: 'blur(30px)',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,1) 56%)',
            }}
          >
            {/* 装饰性标题 — 左右对称分隔线 */}
            <div className="mb-4 flex items-center gap-3">
              <div
                className="h-px flex-1"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, #FFB088 100%)',
                }}
              />
              <h3 className="shrink-0 font-bold text-gray-800">活动规则</h3>
              <div
                className="h-px flex-1"
                style={{
                  background:
                    'linear-gradient(90deg, #FFB088 0%, transparent 100%)',
                }}
              />
            </div>
            {activity.rules?.html && (
              <div
                className="rich-text text-gray-500 text-sm"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: 内容由管理员后台录入，非用户输入
                dangerouslySetInnerHTML={{ __html: activity.rules.html }}
              />
            )}
          </div>

          {/* 奖品明细 */}
          {(() => {
            const displayPrizes = activity.prizes.filter(
              (p) => p.type !== 'thanks',
            );
            if (displayPrizes.length === 0) return null;
            return (
              <div
                className="mt-10 rounded-[30px] p-6"
                style={{
                  backdropFilter: 'blur(30px)',
                  WebkitBackdropFilter: 'blur(30px)',
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,1) 56%)',
                }}
              >
                {/* 装饰性标题 */}
                <div className="mb-5 flex items-center gap-3">
                  <div
                    className="h-px flex-1"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 0%, #FFB088 100%)',
                    }}
                  />
                  <h3 className="shrink-0 font-bold text-gray-800">奖品明细</h3>
                  <div
                    className="h-px flex-1"
                    style={{
                      background:
                        'linear-gradient(90deg, #FFB088 0%, transparent 100%)',
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {displayPrizes.map((prize) => (
                    <div
                      className="flex flex-col items-center gap-2 rounded-2xl p-3"
                      key={prize.id}
                      style={{ background: 'rgba(255,107,61,0.06)' }}
                    >
                      {prize.image ? (
                        <img
                          alt={prize.name}
                          className="h-16 w-16 rounded-xl object-contain"
                          src={prize.image}
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 text-2xl">
                          {prize.type === 'physical'
                            ? '🎁'
                            : prize.type === 'coupon'
                              ? '🎫'
                              : prize.type === 'points'
                                ? '💰'
                                : '🎯'}
                        </div>
                      )}
                      <span className="text-center font-medium text-gray-700 text-sm leading-tight">
                        {prize.name}
                      </span>
                      {(prize.value?.display as string) && (
                        <span
                          className="font-semibold text-sm"
                          style={{ color: '#FF6B3D' }}
                        >
                          {prize.value?.display as string}
                        </span>
                      )}
                      <span className="text-gray-400 text-xs">
                        {PRIZE_TYPE_LABELS[prize.type] ?? prize.type}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </main>
    </HydrateClient>
  );
}
