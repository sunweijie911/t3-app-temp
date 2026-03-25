'use client';

import { Spin } from 'antd';
import Image from 'next/image';

import { PackageCard } from '@/modules/battery-swap/components/package-card';
import { MODULE_NAME } from '@/modules/battery-swap/constants';
import { api } from '@/trpc/react';

// 检测是否在钉钉环境中
function isDingTalk() {
  if (typeof window === 'undefined') return false;
  return /DingTalk/i.test(navigator.userAgent);
}

// 检测是否为 scheme 协议链接（如 alipays://、weixin:// 等）
function isSchemeLink(link: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(link) && !link.startsWith('http');
}

function handleBuy(link: string) {
  if (typeof window === 'undefined') return;

  // 钉钉环境：使用 dd.openLink
  if (isDingTalk()) {
    const dd = (window as unknown as Record<string, unknown>).dd as
      | { openLink?: (opts: { url: string }) => void }
      | undefined;
    if (dd?.openLink) {
      dd.openLink({ url: link });
      return;
    }
  }

  // scheme 链接（如 alipays://...）：用 location.href 唤起本地 App
  if (isSchemeLink(link)) {
    window.location.href = link;
    return;
  }

  // HTTPS 链接：新窗口打开
  window.open(link, '_blank', 'noopener,noreferrer');
}

export default function BatterySwapHome() {
  const { data: packages, isLoading } = api.batterySwap.list.useQuery();
  const { data: bannerUrl } = api.batterySwap.bannerUrl.useQuery();

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Banner */}
      {bannerUrl && (
        <div className="px-3 pt-3">
          <Image
            alt={MODULE_NAME}
            className="aspect-video w-full rounded-2xl object-cover"
            height={422}
            src={bannerUrl}
            width={750}
          />
        </div>
      )}

      {/* 套餐卡片列表 */}
      <div className="space-y-3 px-3 pt-3 pb-8">
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
            cardBgColor={pkg.cardBgColor}
            company={pkg.company}
            depositMethod={pkg.depositMethod}
            detailImageUrl={pkg.detailImageUrl}
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
