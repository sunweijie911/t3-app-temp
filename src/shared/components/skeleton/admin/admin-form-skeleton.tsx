import { Card, Skeleton } from 'antd';

// 表单骨架 — 模拟标签 + 输入框组合
export function AdminFormSkeleton({
  fields = 4,
  hasTitle = true,
}: {
  fields?: number;
  hasTitle?: boolean;
}) {
  return (
    <Card>
      {hasTitle && (
        <div style={{ marginBottom: 24 }}>
          <Skeleton.Input active style={{ width: 200, height: 28 }} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {Array.from({ length: fields }).map((_, i) => (
          <div
            key={i}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {/* 标签 */}
            <Skeleton.Input active size="small" style={{ width: 80 }} />
            {/* 输入框 */}
            <Skeleton.Input active block />
          </div>
        ))}
      </div>

      {/* 提交按钮 */}
      <div style={{ marginTop: 24 }}>
        <Skeleton.Button active style={{ width: 100 }} />
      </div>
    </Card>
  );
}
