import { SkeletonBlock } from './skeleton-base';

// 列表项骨架 — 模拟 results 页列表结构
export function SkeletonListItem({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl border border-gray-200 p-6 ${className}`}
    >
      {/* 左侧：副标题 + 标题 */}
      <div className="flex flex-col gap-2">
        <SkeletonBlock height={14} rounded="md" width={80} />
        <SkeletonBlock height={20} rounded="md" width={160} />
      </div>
      {/* 右侧：标签 + 日期 */}
      <div className="flex flex-col items-end gap-2">
        <SkeletonBlock height={26} rounded="full" width={64} />
        <SkeletonBlock height={12} rounded="md" width={80} />
      </div>
    </div>
  );
}
