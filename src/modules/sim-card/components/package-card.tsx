'use client';

import { SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';

import { getAccentColor, hexToRgba } from '@/lib/color';
import { formatSimCardPrice } from '@/modules/sim-card/schema';

export type SimCardProps = {
  title: string;
  carrier: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string | null;
  monthlyPrice: number; // 分
  dataAllowance: string | null;
  callMinutes: string | null;
  highlights: string[];
  description: string | null;
  purchaseLink: string | null;
  onBuy: (link: string) => void;
};

export function SimCardPackageCard({
  title,
  carrier,
  imageUrl,
  detailImageUrl,
  cardBgColor,
  monthlyPrice,
  dataAllowance,
  callMinutes,
  highlights,
  description,
  purchaseLink,
  onBuy,
}: SimCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const accent = getAccentColor(cardBgColor);

  return (
    <>
      <div
        className="overflow-hidden rounded-2xl bg-white shadow-sm"
        style={{ borderLeft: `4px solid ${accent}` }}
      >
        {/* 商品图片 */}
        {imageUrl && (
          // biome-ignore lint/performance/noImgElement: 动态上传图片
          <img
            alt={title}
            className="aspect-[2/1] w-full object-cover"
            src={imageUrl}
          />
        )}

        <div className="p-4">
          {/* 标题行 */}
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
                  {carrier}
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
                    {formatSimCardPrice(monthlyPrice)}
                  </span>
                  <span className="text-[10px] text-gray-400">/月</span>
                </div>
              </div>
            </div>
          </div>

          {/* 套餐亮点：流量 + 通话 + 标签 */}
          <div className="space-y-2.5">
            {(dataAllowance || callMinutes) && (
              <div
                className="flex items-center justify-around rounded-xl p-3"
                style={{ backgroundColor: hexToRgba(accent, 0.05) }}
              >
                {dataAllowance && (
                  <div className="flex flex-col items-center">
                    <span
                      className="font-bold text-sm"
                      style={{ color: accent }}
                    >
                      {dataAllowance}
                    </span>
                    <span className="text-[10px] text-gray-400">流量</span>
                  </div>
                )}
                {dataAllowance && callMinutes && (
                  <div
                    className="h-6 w-px"
                    style={{ backgroundColor: hexToRgba(accent, 0.2) }}
                  />
                )}
                {callMinutes && (
                  <div className="flex flex-col items-center">
                    <span
                      className="font-bold text-sm"
                      style={{ color: accent }}
                    >
                      {callMinutes}
                    </span>
                    <span className="text-[10px] text-gray-400">通话</span>
                  </div>
                )}
              </div>
            )}

            {/* 亮点标签 */}
            {highlights.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {highlights.map((tag, idx) => (
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px]"
                    key={idx}
                    style={{
                      backgroundColor: hexToRgba(accent, 0.08),
                      color: accent,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* 套餐说明 */}
            {description && (
              <p className="text-[11px] text-gray-500 leading-relaxed">
                {description}
              </p>
            )}
          </div>

          {/* 办理按钮 */}
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
            立即办理
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
            {/* biome-ignore lint/performance/noImgElement: 详情长图 */}
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
