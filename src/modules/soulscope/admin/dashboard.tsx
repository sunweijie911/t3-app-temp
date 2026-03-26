import { Card, Col, Row, Statistic } from 'antd';
import Link from 'next/link';
import { getModule } from '@/modules/registry';
import { MODULE_NAME } from '@/modules/soulscope/constants';
import { api, HydrateClient } from '@/trpc/server';

export const metadata = {
  title: `${MODULE_NAME} 管理 - 管理后台`,
};

export default async function AdminSoulscopePage() {
  const mod = getModule('soulscope');
  const stats = await api.soulscope.admin.stats();

  return (
    <HydrateClient>
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
          {/* 页头 */}
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#111827',
              marginBottom: 32,
            }}
          >
            {MODULE_NAME} 管理
          </h1>

          {/* 统计卡片 */}
          <Row gutter={16} style={{ marginBottom: 32 }}>
            <Col span={6}>
              <Card>
                <Statistic title="总用户数" value={stats.totalUsers} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="总测试数" value={stats.totalAttempts} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="已完成" value={stats.totalCompleted} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic prefix="¥" title="总收入" value={stats.revenue} />
              </Card>
            </Col>
          </Row>

          {/* 导航卡片 */}
          <Row gutter={16}>
            {mod.adminNavItems.map((item) => (
              <Col key={item.href} sm={8} xs={24}>
                <Link
                  href={item.href}
                  style={{ display: 'block', marginBottom: 16 }}
                >
                  {/* cspell:disable-next-line */}
                  <Card hoverable>
                    <h3
                      style={{ fontWeight: 600, marginBottom: 4, fontSize: 15 }}
                    >
                      {item.label}
                    </h3>
                    <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
                      {item.description}
                    </p>
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        </div>
      </main>
    </HydrateClient>
  );
}
