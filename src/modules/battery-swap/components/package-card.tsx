import dayjs from 'dayjs';
import type { PackageSpec } from '@/modules/battery-swap/schema';
import { formatPrice } from '@/modules/battery-swap/schema';

type PackageCardProps = {
  title: string;
  company: string;
  imageUrl: string | null;
  originalPrice: number; // 分
  salePrice: number; // 分
  specs: PackageSpec[];
  depositMethod: string | null;
  regionLimit: string | null;
  purchaseNotes: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  purchaseLink: string | null;
  onBuy: (link: string) => void;
};

export function PackageCard({
  title,
  company,
  imageUrl,
  originalPrice,
  salePrice,
  specs,
  depositMethod,
  regionLimit,
  purchaseNotes,
  validFrom,
  validTo,
  purchaseLink,
  onBuy,
}: PackageCardProps) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl bg-white shadow-sm">
      {/* 商品大图 */}
      {imageUrl && (
        <img alt={title} className="h-40 w-full object-cover" src={imageUrl} />
      )}

      <div className="px-3 pt-2.5 pb-3">
        {/* 公司 Tag + 标题 — 同行排列 */}
        <div className="mb-1.5 flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0 rounded bg-green-50 px-1.5 py-px text-2.5 text-green-600">
            {company}
          </span>
          <h3 className="font-bold text-gray-900 text-sm leading-5">{title}</h3>
        </div>

        {/* 价格行 */}
        <div className="mb-2 flex items-baseline gap-1.5">
          <span className="font-bold text-lg text-red-500 leading-none">
            ¥{formatPrice(salePrice)}
          </span>
          <span className="text-gray-400 text-xs line-through">
            ¥{formatPrice(originalPrice)}
          </span>
        </div>

        {/* 规格标签 */}
        {specs.length > 0 && (
          <div className="mb-2 flex gap-1.5">
            {specs.map((s, idx) => (
              <div
                className="flex-1 rounded-lg border border-green-100 bg-green-50/50 px-2 py-1.5"
                key={idx}
              >
                <div className="text-center font-medium text-gray-700 text-xs">
                  {s.model}
                </div>
                <div className="text-center font-bold text-red-500 text-xs">
                  ¥{formatPrice(s.price)}
                  <span className="font-normal text-gray-400">/月</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 信息列表 */}
        <div className="space-y-1 text-gray-500 text-xs">
          {depositMethod && (
            <div className="flex">
              <span className="w-14 shrink-0 text-gray-400">押金</span>
              <span className="text-gray-600">{depositMethod}</span>
            </div>
          )}
          {regionLimit && (
            <div className="flex">
              <span className="w-14 shrink-0 text-gray-400">区域</span>
              <span className="whitespace-pre-wrap text-gray-600">
                {regionLimit}
              </span>
            </div>
          )}
          {purchaseNotes && (
            <div className="flex">
              <span className="w-14 shrink-0 text-gray-400">须知</span>
              <span className="whitespace-pre-wrap text-gray-600">
                {purchaseNotes}
              </span>
            </div>
          )}
          {validFrom && validTo && (
            <div className="flex">
              <span className="w-14 shrink-0 text-gray-400">有效期</span>
              <span className="text-gray-600">
                {dayjs(validFrom).format('YYYY.MM.DD')} -{' '}
                {dayjs(validTo).format('YYYY.MM.DD')}
              </span>
            </div>
          )}
        </div>

        {/* 购买按钮 */}
        <button
          className="mt-2.5 w-full rounded-lg bg-gradient-to-r from-green-500 to-green-600 py-2.5 font-bold text-sm text-white active:from-green-600 active:to-green-700 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-400"
          disabled={!purchaseLink}
          onClick={() => purchaseLink && onBuy(purchaseLink)}
          type="button"
        >
          立即购买 ¥{formatPrice(salePrice)} 起
        </button>
      </div>
    </div>
  );
}
