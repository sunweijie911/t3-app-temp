import { Header } from '@/app/_components/layout/header';
import { ModuleSwitcher } from '@/app/admin/_components/module-switcher';
import { getModule } from '@/modules/registry';
import { api, HydrateClient } from '@/trpc/server';
import { StatsDisplay } from './_components/stats-display';

export const metadata = {
  title: '大转盘管理 - 管理后台',
};

export default async function AdminLuckyWheelPage() {
  const mod = getModule('lucky-wheel');
  const stats = await api.luckyWheel.admin.stats();

  // 以 activityId 为 key 合并 drawStats + prizeStats
  const byActivity = stats.activityDrawStats.reduce<
    Record<
      string,
      {
        activityId: string;
        activityName: string;
        totalDraws: number;
        totalWins: number;
        prizes: typeof stats.prizeStats;
      }
    >
  >((acc, a) => {
    acc[a.activityId] = {
      activityId: a.activityId,
      activityName: a.activityName,
      totalDraws: a.totalDraws,
      totalWins: a.totalWins,
      prizes: stats.prizeStats.filter((p) => p.activityId === a.activityId),
    };
    return acc;
  }, {});

  return (
    <HydrateClient>
      <Header />
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 24,
            }}
          >
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: '#111827',
                margin: 0,
              }}
            >
              大转盘管理
            </h1>
            <ModuleSwitcher currentModuleId="lucky-wheel" />
          </div>

          <StatsDisplay byActivity={byActivity} navItems={mod.adminNavItems} />
        </div>
      </main>
    </HydrateClient>
  );
}
