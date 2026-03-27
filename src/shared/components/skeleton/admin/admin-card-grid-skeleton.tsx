import { Card, Col, Row, Skeleton } from 'antd';

// 导航卡片网格骨架 — 模拟 Dashboard 底部导航区域
export function AdminCardGridSkeleton({
  count = 3,
  colSpan = 8,
}: {
  count?: number;
  colSpan?: number;
}) {
  return (
    <Row gutter={16}>
      {Array.from({ length: count }).map((_, i) => (
        <Col key={i} sm={colSpan} xs={24}>
          <div style={{ marginBottom: 16 }}>
            <Card>
              <Skeleton
                active
                paragraph={{ rows: 1, width: '80%' }}
                title={{ width: '50%' }}
              />
            </Card>
          </div>
        </Col>
      ))}
    </Row>
  );
}
