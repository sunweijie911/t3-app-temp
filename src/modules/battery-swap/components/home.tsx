'use client';

import { Spin } from 'antd';

import { PackageCard } from '@/modules/battery-swap/components/package-card';
import { api } from '@/trpc/react';

// 检测是否在钉钉环境中
function isDingTalk() {
  if (typeof window === 'undefined') return false;
  return /DingTalk/i.test(navigator.userAgent);
}

function handleBuy(link: string) {
  if (isDingTalk() && typeof window !== 'undefined') {
    // 钉钉环境使用 dd.openLink
    const dd = (window as unknown as Record<string, unknown>).dd as
      | { openLink?: (opts: { url: string }) => void }
      | undefined;
    if (dd?.openLink) {
      dd.openLink({ url: link });
      return;
    }
  }
  // 普通浏览器用 window.open
  window.open(link, '_blank', 'noopener,noreferrer');
}

export default function BatterySwapHome() {
  const { data: packages, isLoading } = api.batterySwap.list.useQuery();

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 页头 — 固定高度，不被卡片遮挡 */}
      <div className="bg-gradient-to-r from-green-500 to-green-600 px-4 pt-12 pb-8 text-white">
        <h1 className="font-bold text-xl">换电套餐</h1>
        <p className="mt-0.5 text-green-100 text-xs">
          多家品牌换电方案，一站对比选购
        </p>
      </div>

      {/* 卡片列表 — 圆角上移与页头衔接 */}
      <div className="-mt-4 rounded-t-2xl bg-gray-100 px-3 pt-4 pb-8">
        {isLoading && (
          <div className="flex justify-center py-20">
            <Spin size="large" />
          </div>
        )}

        {!isLoading && (!packages || packages.length === 0) && (
          <div className="py-20 text-center text-gray-400">暂无可用套餐</div>
        )}

        {packages?.map((pkg) => (
          <PackageCard
            company={pkg.company}
            depositMethod={pkg.depositMethod}
            imageUrl={pkg.imageUrl}
            key={pkg.id}
            onBuy={handleBuy}
            originalPrice={pkg.originalPrice}
            purchaseLink={pkg.purchaseLink}
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
