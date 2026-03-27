import { SkeletonBlock, SkeletonText } from './skeleton-base';

// 详情页骨架 — 标题 + 标签 + 段落 + 可选图表区
export function SkeletonDetail({
  showChart = false,
  className = '',
}: {
  showChart?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* 标题 */}
      <SkeletonBlock className="w-2/5" height={32} rounded="lg" />
      {/* 标签行 */}
      <div className="flex gap-3">
        <SkeletonBlock height={28} rounded="full" width={72} />
        <SkeletonBlock height={28} rounded="full" width={56} />
        <SkeletonBlock height={28} rounded="full" width={88} />
      </div>
      {/* 段落文字 */}
      <SkeletonText gap={10} lineHeight={16} lines={5} />
      {/* 可选图表区域 */}
      {showChart && (
        <SkeletonBlock className="w-full" height={240} rounded="xl" />
      )}
      {/* 额外段落 */}
      <SkeletonText gap={10} lineHeight={16} lines={3} />
    </div>
  );
}
