import { Card, Skeleton } from 'antd';

// 表格骨架 — 模拟 antd Table 的表头 + 数据行结构
export function AdminTableSkeleton({
  columns = 5,
  rows = 8,
  hasFilter = false,
}: {
  columns?: number;
  rows?: number;
  hasFilter?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 可选：筛选区域骨架 */}
      {hasFilter && (
        <Card>
          <div style={{ display: 'flex', gap: 16 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton.Input active key={i} style={{ width: 200 }} />
            ))}
            <Skeleton.Button active />
          </div>
        </Card>
      )}

      {/* 表格骨架 */}
      <Card>
        {/* 表头 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 16,
            paddingBottom: 16,
            borderBottom: '1px solid #f0f0f0',
            marginBottom: 8,
          }}
        >
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton.Input
              active
              key={i}
              size="small"
              style={{ width: '80%', minWidth: 60 }}
            />
          ))}
        </div>

        {/* 数据行 */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: 16,
              padding: '12px 0',
              borderBottom: '1px solid #fafafa',
            }}
          >
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton.Input
                active
                key={colIdx}
                size="small"
                style={{
                  width: colIdx === 0 ? '60%' : '70%',
                  minWidth: 40,
                }}
              />
            ))}
          </div>
        ))}

        {/* 分页区域 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 16,
          }}
        >
          <Skeleton.Input active size="small" style={{ width: 80 }} />
          <Skeleton.Button active size="small" />
          <Skeleton.Button active size="small" />
          <Skeleton.Button active size="small" />
        </div>
      </Card>
    </div>
  );
}
