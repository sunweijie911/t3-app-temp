import type { ComponentProps } from 'react';
import { SkeletonCard } from './skeleton-card';

// 卡片网格骨架 — 模拟前台卡片列表
export function SkeletonCardGrid({
  count = 6,
  cardProps,
  className = '',
}: {
  count?: number;
  cardProps?: ComponentProps<typeof SkeletonCard>;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} {...cardProps} />
      ))}
    </div>
  );
}
