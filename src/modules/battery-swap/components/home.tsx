'use client';

import { openLink } from '@/lib/dingtalk-utils';
import { PackageCard } from '@/modules/battery-swap/components/package-card';
import { PackageCardSkeletonList } from '@/modules/battery-swap/components/package-card-skeleton';
import { MODULE_NAME } from '@/modules/battery-swap/constants';
import { SkeletonBlock } from '@/shared/components/skeleton';
import { api } from '@/trpc/react';

function handleBuy(link: string) {
  openLink(link);
}

export default function BatterySwapHome() {
  const { data: packages, isLoading } = api.batterySwap.list.useQuery();
  const { data: bannerUrl } = api.batterySwap.bannerUrl.useQuery();

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Banner */}
      {isLoading && !bannerUrl ? (
        <div className="px-3 pt-3">
          <SkeletonBlock className="aspect-video w-full" rounded="2xl" />
        </div>
      ) : bannerUrl ? (
        <div className="px-3 pt-3">
          {/* 运行时上传的动态图片，使用 img 避免走 /_next/image 优化端点 */}
          {/* biome-ignore lint/performance/noImgElement: 动态上传图片，尺寸不固定 */}
          <img
            alt={MODULE_NAME}
            className="aspect-video w-full rounded-2xl object-cover"
            src={bannerUrl}
          />
        </div>
      ) : null}

      {/* 套餐卡片列表 */}
      <div className="space-y-3 px-3 pt-3 pb-8">
        {isLoading && <PackageCardSkeletonList count={3} />}

        {!isLoading && (!packages || packages.length === 0) && (
          <div className="py-20 text-center text-gray-400">暂无可用套餐</div>
        )}

        {packages?.map((pkg) => (
          <PackageCard
            buttons={pkg.buttons}
            cardBgColor={pkg.cardBgColor}
            company={pkg.company}
            depositMethod={pkg.depositMethod}
            detailImageUrl={pkg.detailImageUrl}
            imageUrl={pkg.imageUrl}
            key={pkg.id}
            onBuy={handleBuy}
            originalPrice={pkg.originalPrice}
            purchaseNotes={pkg.purchaseNotes}
            regionLimit={pkg.regionLimit}
            salePrice={pkg.salePrice}
            specs={pkg.specs}
            title={pkg.title}
            validFrom={pkg.validFrom}
            validTo={pkg.validTo}
          />
        ))}
      </div>
    </div>
  );
}
