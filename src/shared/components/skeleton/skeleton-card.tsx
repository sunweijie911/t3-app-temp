import { SkeletonBlock, SkeletonText } from './skeleton-base';

// 卡片骨架 — 模拟 TestCard / ActivityCard 结构
export function SkeletonCard({
  imageHeight = 120,
  lines = 2,
  className = '',
}: {
  imageHeight?: number;
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-gray-100 bg-white ${className}`}
    >
      {/* 图片区域 */}
      <SkeletonBlock className="w-full" height={imageHeight} rounded="none" />
      {/* 内容区域 */}
      <div className="space-y-3 p-4">
        {/* 标题 */}
        <SkeletonBlock className="w-3/5" height={20} rounded="md" />
        {/* 描述文字 */}
        <SkeletonText
          gap={8}
          lineHeight={14}
          lines={lines}
          widths={['90%', '70%']}
        />
      </div>
    </div>
  );
}
