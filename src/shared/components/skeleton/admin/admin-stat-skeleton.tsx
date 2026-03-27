import { Card, Col, Row, Skeleton } from 'antd';

// 统计卡片骨架 — 模拟 Dashboard 的 Statistic 布局
export function AdminStatSkeleton({ count = 4 }: { count?: number }) {
  const colSpan = Math.floor(24 / count);

  return (
    <Row gutter={16}>
      {Array.from({ length: count }).map((_, i) => (
        <Col key={i} span={colSpan}>
          <Card>
            <Skeleton
              active
              paragraph={{ rows: 1, width: '60%' }}
              title={{ width: '40%' }}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}
