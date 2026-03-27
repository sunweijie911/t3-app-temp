import { SkeletonBlock } from '@/shared/components/skeleton';

// SIM 卡首页完整骨架 — 匹配 SimCardHome 布局
export function SimCardHomeSkeleton() {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Banner 骨架 */}
      <div className="px-3 pt-3">
        <SkeletonBlock className="aspect-video w-full" rounded="2xl" />
      </div>

      {/* 用户信息卡片骨架 */}
      <div className="mx-3 mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div className="flex items-center justify-between" key={i}>
              <SkeletonBlock height={16} rounded="md" width={56} />
              <SkeletonBlock height={16} rounded="md" width={96} />
            </div>
          ))}
        </div>
      </div>

      {/* 套餐卡片列表骨架 */}
      <div className="space-y-3 px-3 pt-3 pb-8">
        {[1, 2, 3].map((i) => (
          <SimCardPackageSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// SIM 卡套餐卡片骨架 — 匹配 SimCardPackageCard 布局
function SimCardPackageSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-white shadow-sm"
      style={{ borderLeft: '4px solid #e5e7eb' }}
    >
      {/* 商品图片 */}
      <SkeletonBlock className="aspect-[2/1] w-full" rounded="none" />

      <div className="p-4">
        {/* 标题行 */}
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
          </div>
        </div>

        <div className="space-y-2.5">
          {/* 流量 + 通话 */}
          <div className="flex items-center justify-around rounded-xl bg-gray-50 p-3">
            <div className="flex flex-col items-center gap-1">
              <SkeletonBlock height={16} rounded="sm" width={48} />
              <SkeletonBlock height={10} rounded="sm" width={24} />
            </div>
            <div className="h-6 w-px bg-gray-200" />
            <div className="flex flex-col items-center gap-1">
              <SkeletonBlock height={16} rounded="sm" width={48} />
              <SkeletonBlock height={10} rounded="sm" width={24} />
            </div>
          </div>

          {/* 亮点标签 */}
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3].map((i) => (
              <SkeletonBlock height={22} key={i} rounded="full" width={56} />
            ))}
          </div>
        </div>

        {/* 办理按钮 */}
        <SkeletonBlock className="mt-4 w-full" height={42} rounded="xl" />
      </div>
    </div>
  );
}

// 套餐列表骨架（供外部使用）
export function SimCardPackageSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SimCardPackageSkeleton key={i} />
      ))}
    </div>
  );
}
