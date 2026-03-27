import { SkeletonListItem } from './skeleton-list-item';

// 列表骨架 — 多个列表项
export function SkeletonList({
  count = 5,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  );
}
