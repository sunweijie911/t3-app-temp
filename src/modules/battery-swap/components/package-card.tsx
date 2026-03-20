'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { PackageSpec } from '@/modules/battery-swap/schema';
import { formatPrice } from '@/modules/battery-swap/schema';

type PackageCardProps = {
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
  onBuy: (link: string) => void;
};

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
  onBuy,
}: PackageCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div
        className="mb-4 overflow-hidden rounded-2xl shadow"
        style={{ backgroundColor: cardBgColor ?? '#ffffff' }}
      >
        {/* 商品大图 */}
        {imageUrl && (
          <Image
            alt={title}
            className="aspect-[2/1] w-full object-cover"
            height={200}
            src={imageUrl}
            width={400}
          />
        )}

        <div className="p-4">
          {/* 公司 + 标题 */}
          <div className="mb-2 flex items-center gap-2">
            <span className="shrink-0 rounded-md bg-green-500 px-2 py-0.5 font-medium text-white text-xs">
              {company}
            </span>
            <h3 className="font-bold text-base text-gray-900 leading-snug">
              {title}
            </h3>
          </div>

          {/* 价格区 */}
          <div className="mb-3 flex items-baseline gap-1.5">
            <span className="font-bold text-red-500 text-sm">¥</span>
            <span className="font-extrabold text-2xl text-red-500 leading-none">
              {formatPrice(salePrice)}
            </span>
            <span className="text-gray-300 text-xs line-through">
              ¥{formatPrice(originalPrice)}
            </span>
          </div>

          {/* 规格 */}
          {specs.length > 0 && (
            <div className="mb-3 flex gap-2">
              {specs.map((s, idx) => (
                <div
                  className="flex-1 rounded-xl border border-green-100 bg-green-50/60 px-2 py-2 text-center"
                  key={idx}
                >
                  <div className="font-medium text-gray-600 text-xs">
                    {s.model}
                  </div>
                  <div className="mt-0.5">
                    <span className="font-bold text-red-500 text-sm">
                      ¥{formatPrice(s.price)}
                    </span>
                    <span className="text-[10px] text-gray-400">/月</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 信息标签 */}
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-gray-400 text-xs">
            {depositMethod && <span>押金：{depositMethod}</span>}
            {regionLimit && <span>区域：{regionLimit}</span>}
            {purchaseNotes && <span>须知：{purchaseNotes}</span>}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2">
            {detailImageUrl && (
              <button
                className="rounded-xl border border-green-200 bg-green-50 px-5 py-2.5 font-medium text-green-600 text-sm active:bg-green-100"
                onClick={() => setShowDetail(true)}
                type="button"
              >
                查看详情
              </button>
            )}
            <button
              className="flex-1 rounded-xl bg-gradient-to-r from-green-500 to-green-600 py-2.5 font-bold text-sm text-white active:from-green-600 active:to-green-700 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-400"
              disabled={!purchaseLink}
              onClick={() => purchaseLink && onBuy(purchaseLink)}
              type="button"
            >
              立即购买
            </button>
          </div>
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
