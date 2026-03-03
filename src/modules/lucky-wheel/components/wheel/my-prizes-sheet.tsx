'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import { RecordListContent } from '@/modules/lucky-wheel/components/record/my-records';
import { api } from '@/trpc/react';

interface MyPrizesSheetProps {
  isLoggedIn: boolean;
}

export interface MyPrizesSheetHandle {
  open: () => void;
}

export const MyPrizesSheet = forwardRef<
  MyPrizesSheetHandle,
  MyPrizesSheetProps
>(function MyPrizesSheet({ isLoggedIn }, ref) {
  const [open, setOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
  }));

  // 登录后即预加载数据，打开弹窗时直接展示缓存，避免骨架闪烁
  const { data: records, isLoading } = api.luckyWheel.record.myRecords.useQuery(
    undefined,
    {
      enabled: isLoggedIn,
    },
  );

  return (
    <>
      {/* 浮动按钮 — 竖排文字 */}
      <button
        className="fixed top-1/2 right-0 z-40 -translate-y-1/2 rounded-l-lg px-1.5 py-3 font-semibold text-sm text-white shadow-lg transition-transform hover:translate-x-0 active:scale-95"
        onClick={() => setOpen(true)}
        style={{
          writingMode: 'vertical-rl',
          background: 'linear-gradient(180deg, #FF6B3D 0%, #E8441A 100%)',
          letterSpacing: '0.15em',
        }}
        type="button"
      >
        我的奖品
      </button>

      {/* 底部弹出层 */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* 遮罩 */}
          {/* biome-ignore lint/a11y/useSemanticElements: 遮罩层覆盖全屏，用 div 更合适 */}
          <div
            aria-label="关闭"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            role="button"
            tabIndex={0}
          />

          {/* Sheet 内容 */}
          <div className="lw-sheet-slide-up relative z-10 max-h-[70vh] overflow-hidden rounded-t-3xl bg-gradient-to-b from-orange-50 to-white">
            {/* 拖拽指示条 */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>

            {/* 标题 + 关闭按钮 */}
            <div className="flex items-center justify-between px-5 pb-3">
              <h3 className="font-bold text-gray-900 text-lg">我的奖品</h3>
              <button
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500"
                onClick={() => setOpen(false)}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="14"
                  viewBox="0 0 14 14"
                  width="14"
                >
                  <path
                    d="M1 1L13 13M13 1L1 13"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            </div>

            {/* 列表区域 — 固定最小高度避免加载时高度跳变 */}
            <div
              className="overflow-y-auto px-4 pb-8"
              style={{ maxHeight: 'calc(70vh - 80px)', minHeight: '200px' }}
            >
              {isLoggedIn ? (
                <RecordListContent isLoading={isLoading} records={records} />
              ) : (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  请先登录后查看
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
