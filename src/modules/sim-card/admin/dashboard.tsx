import { Card, Col, Row } from 'antd';
import Link from 'next/link';
import { getModule } from '@/modules/registry';
import { MODULE_NAME } from '@/modules/sim-card/constants';

export const metadata = {
  title: `${MODULE_NAME} 管理 - 管理后台`,
};

function DashboardNav() {
  const mod = getModule('sim-card');

  return (
    <Row gutter={16}>
      {mod.adminNavItems.map((item) => (
        <Col key={item.href} sm={8} xs={24}>
          <Link href={item.href} style={{ display: 'block', marginBottom: 16 }}>
            <Card hoverable>
              <h3 style={{ fontWeight: 600, marginBottom: 4, fontSize: 15 }}>
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
  );
}

export default function AdminSimCardDashboardPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
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

        <DashboardNav />
      </div>
    </main>
  );
}
