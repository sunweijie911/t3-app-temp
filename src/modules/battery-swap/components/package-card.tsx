'use client';

import {
  CalendarOutlined,
  EnvironmentOutlined,
  InfoCircleOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useState } from 'react';

import type { PackageSpec } from '@/modules/battery-swap/schema';
import { formatPrice } from '@/modules/battery-swap/schema';

export type PackageCardProps = {
  title: string;
  company: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string | null;
  originalPrice: number;
  salePrice: number;
  specs: PackageSpec[];
  depositMethod: string | null;
  regionLimit: string | null;
  purchaseNotes: string | null;
  purchaseLink: string | null;
  validFrom: Date | string | null;
  validTo: Date | string | null;
  onBuy: (link: string) => void;
};

// 将 hex 颜色转为 rgba
function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(0,82,208,${alpha})`;
  const [, r, g, b] = result;
  return `rgba(${parseInt(r ?? '0', 16)},${parseInt(g ?? '0', 16)},${parseInt(b ?? '0', 16)},${alpha})`;
}

// 获取卡片主题色：白色/空值时回退为品牌蓝
function getAccentColor(cardBgColor: string | null): string {
  if (
    !cardBgColor ||
    cardBgColor.toLowerCase() === '#ffffff' ||
    cardBgColor.toLowerCase() === '#fff'
  ) {
    return '#0052d0';
  }
  return cardBgColor;
}

// 格式化有效期范围
function formatDateRange(
  from: Date | string | null,
  to: Date | string | null,
): string {
  if (!from && !to) return '长期有效';
  const fmt = (d: Date | string) => {
    const date = typeof d === 'string' ? new Date(d) : d;
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };
  if (from && to) return `${fmt(from)} - ${fmt(to)}`;
  if (from) return `${fmt(from)} 起`;
  // to 一定存在（前面已排除 !from && !to 和 from 存在的情况）
  return `截至 ${fmt(to as Date | string)}`;
}

export function PackageCard({
  title,
  company,
  imageUrl,
  detailImageUrl,
  cardBgColor,
  originalPrice,
  salePrice,
  specs,
  depositMethod,
  regionLimit,
  purchaseNotes,
  purchaseLink,
  validFrom,
  validTo,
  onBuy,
}: PackageCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const accent = getAccentColor(cardBgColor);

  return (
    <>
      <div
        className="overflow-hidden rounded-2xl bg-white shadow-sm"
        style={{ borderLeft: `4px solid ${accent}` }}
      >
        {/* 商品大图 */}
        {/* biome-ignore lint/performance/noImgElement: 运行时上传的动态图片，使用 img 避免走 /_next/image 优化端点 */}
        {imageUrl && (
          <img
            alt={title}
            className="aspect-[2/1] w-full object-cover"
            src={imageUrl}
          />
        )}

        <div className="p-4">
          {/* 标题行：左侧公司标签+标题，右侧查看详情+价格 */}
          <div className="mb-3 flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="shrink-0 rounded-md px-2 py-0.5 font-bold text-[10px]"
                  style={{
                    backgroundColor: hexToRgba(accent, 0.12),
                    color: accent,
                  }}
                >
                  {company}
                </span>
              </div>
              <h3 className="font-bold text-base text-gray-900 leading-tight">
                {title}
              </h3>
            </div>
            <div className="ml-3 flex shrink-0 flex-col items-end">
              {detailImageUrl && (
                <button
                  className="mb-1 flex cursor-pointer items-center gap-1 font-medium text-[10px]"
                  onClick={() => setShowDetail(true)}
                  style={{ color: hexToRgba(accent, 0.6) }}
                  type="button"
                >
                  <SearchOutlined style={{ fontSize: 12, color: accent }} />
                  <span>查看详情</span>
                </button>
              )}
              <div className="text-right">
                <div className="flex items-baseline gap-1">
                  <span
                    className="font-bold text-[10px]"
                    style={{ color: accent }}
                  >
                    ¥
                  </span>
                  <span
                    className="font-black text-xl leading-none"
                    style={{ color: accent }}
                  >
                    {formatPrice(salePrice)}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 leading-none line-through">
                  ¥{formatPrice(originalPrice)}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {/* 规格横排 */}
            {specs.length > 0 && (
              <div
                className="flex items-center justify-between rounded-xl p-3"
                style={{ backgroundColor: hexToRgba(accent, 0.05) }}
              >
                {specs.map((s, idx) => (
                  <div className="contents" key={idx}>
                    {idx > 0 && (
                      <div
                        className="h-6 w-px"
                        style={{
                          backgroundColor: hexToRgba(accent, 0.2),
                        }}
                      />
                    )}
                    <div className="flex flex-col">
                      <span
                        className="font-semibold text-[10px]"
                        style={{ color: hexToRgba(accent, 0.8) }}
                      >
                        {s.model}
                      </span>
                      <span
                        className="font-bold text-xs"
                        style={{ color: accent }}
                      >
                        ¥{formatPrice(s.price)}/月
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 信息网格 */}
            <div className="grid grid-cols-2 gap-y-2 text-[11px]">
              {depositMethod && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <SafetyCertificateOutlined
                    style={{ fontSize: 14, color: accent }}
                  />
                  <span>{depositMethod}</span>
                </div>
              )}
              {regionLimit && (
                <div className="flex items-center gap-1.5 text-gray-500">
                  <EnvironmentOutlined
                    style={{ fontSize: 14, color: accent }}
                  />
                  <span>{regionLimit}</span>
                </div>
              )}
              {purchaseNotes && (
                <div className="col-span-2 flex items-start gap-1.5 text-gray-500">
                  <InfoCircleOutlined
                    className="mt-0.5"
                    style={{ fontSize: 14, color: accent }}
                  />
                  <span>{purchaseNotes}</span>
                </div>
              )}
              <div className="col-span-2 flex items-center gap-1.5 text-gray-400">
                <CalendarOutlined style={{ fontSize: 14, color: accent }} />
                <span>{formatDateRange(validFrom, validTo)}</span>
              </div>
            </div>
          </div>

          {/* 购买按钮 */}
          <button
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!purchaseLink}
            onClick={() => purchaseLink && onBuy(purchaseLink)}
            style={{
              backgroundColor: accent,
              boxShadow: `0 10px 15px -3px ${hexToRgba(accent, 0.2)}`,
            }}
            type="button"
          >
            立即购买 ¥{formatPrice(salePrice)} 起
          </button>
        </div>
      </div>

      {/* 详情长图弹层 */}
      {showDetail && detailImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70"
          onClick={() => setShowDetail(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowDetail(false)}
          role="dialog"
        >
          <div
            className="relative mx-auto my-4 w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="document"
          >
            <button
              className="sticky top-2 z-10 float-right mr-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white text-xl"
              onClick={() => setShowDetail(false)}
              type="button"
            >
              ×
            </button>
            {/* biome-ignore lint/performance/noImgElement: 详情长图为用户上传的动态长图，尺寸不固定，img 更合适 */}
            <img
              alt="详情长图"
              className="mx-auto w-full"
              src={detailImageUrl}
            />
          </div>
        </div>
      )}
    </>
  );
}
