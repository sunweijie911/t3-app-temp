import { SkeletonBlock } from '@/shared/components/skeleton';

// 套餐卡片骨架 — 匹配 PackageCard 的布局结构
export function PackageCardSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-white shadow-sm"
      style={{ borderLeft: '4px solid #e5e7eb' }}
    >
      {/* 商品大图 */}
      <SkeletonBlock className="aspect-[2/1] w-full" rounded="none" />

      <div className="p-4">
        {/* 标题行：左侧公司标签+标题，右侧价格 */}
        <div className="mb-3 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1">
              <SkeletonBlock height={20} rounded="md" width={48} />
            </div>
            <SkeletonBlock height={20} rounded="md" width="70%" />
          </div>
          <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
            <SkeletonBlock height={14} rounded="md" width={56} />
            <SkeletonBlock height={24} rounded="md" width={72} />
            <SkeletonBlock height={12} rounded="md" width={48} />
          </div>
        </div>

        <div className="space-y-2.5">
          {/* 规格横排 */}
          <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
            {[1, 2, 3].map((i) => (
              <div className="flex flex-col gap-1" key={i}>
                <SkeletonBlock height={12} rounded="sm" width={48} />
                <SkeletonBlock height={14} rounded="sm" width={56} />
              </div>
            ))}
          </div>

          {/* 信息网格 */}
          <div className="grid grid-cols-2 gap-y-2">
            <SkeletonBlock height={14} rounded="md" width="60%" />
            <SkeletonBlock height={14} rounded="md" width="50%" />
            <div className="col-span-2">
              <SkeletonBlock height={14} rounded="md" width="80%" />
            </div>
          </div>
        </div>

        {/* 购买按钮 */}
        <SkeletonBlock className="mt-4 w-full" height={42} rounded="xl" />
      </div>
    </div>
  );
}

// 多个套餐卡片骨架
export function PackageCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <PackageCardSkeleton key={i} />
      ))}
    </div>
  );
}
