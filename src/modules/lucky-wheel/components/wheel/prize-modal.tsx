'use client';

import Image from 'next/image';
import { useEffect, useMemo } from 'react';

interface PrizeModalProps {
  open: boolean;
  onClose: () => void;
  onViewPrizes?: () => void;
  isWin: boolean;
  prize: {
    name: string;
    image: string | null;
    type: string;
  } | null;
}

// 未中奖鼓励文案
const ENCOURAGE_TEXTS = [
  '很遗憾没有中奖，下次再来试试吧！',
  '运气就在下一次，再试一次！',
  '好运即将降临，再来一把！',
  '差一点就中了，继续加油！',
];

// 彩带颜色
const CONFETTI_COLORS = [
  '#FF6B3D',
  '#FFD700',
  '#FF4081',
  '#4FC3F7',
  '#66BB6A',
  '#FF8A65',
  '#AB47BC',
  '#FFA726',
];

function ConfettiEffect() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 1.2}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotation: Math.random() * 360,
        size: 6 + Math.random() * 6,
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      {pieces.map((p) => (
        <div
          className="lw-confetti-piece"
          key={p.id}
          style={{
            left: p.left,
            top: '-8px',
            animationDelay: p.delay,
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
            transform: `rotate(${p.rotation}deg)`,
            borderRadius: p.id % 3 === 0 ? '50%' : '2px',
          }}
        />
      ))}
    </div>
  );
}

export function PrizeModal({
  open,
  onClose,
  onViewPrizes,
  isWin,
  prize,
}: PrizeModalProps) {
  // 随机选一句鼓励文案（useMemo 保证同一次弹窗内文案不变）
  const encourageText = useMemo(
    () => ENCOURAGE_TEXTS[Math.floor(Math.random() * ENCOURAGE_TEXTS.length)],
    [],
  );

  // 弹窗打开时禁止页面滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  if (!open) return null;

  const isPhysical = isWin && prize?.type === 'physical';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="lw-modal-slide-up relative mx-4 w-full max-w-sm overflow-hidden rounded-3xl p-8 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
        style={{
          background:
            'linear-gradient(180deg, #FFD6D6 0%, #FFF1F3 13%, #FFF 100%)',
        }}
      >
        {/* 中奖时的彩带动画 */}
        {isWin && prize && <ConfettiEffect />}

        {/* 关闭按钮 */}
        <button
          aria-label="关闭"
          className="absolute top-3 right-3 z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-black/20 text-white transition-opacity hover:bg-black/30"
          onClick={onClose}
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

        {isWin && prize ? (
          <>
            <div className="lw-prize-float relative z-1 mb-4 inline-block text-5xl">
              &#127881;
            </div>
            <h2 className="relative z-1 mb-2 font-bold text-2xl text-gray-900">
              恭喜中奖！
            </h2>
            {prize.image ? (
              <div className="relative z-1 mx-auto mb-4 flex items-center justify-center">
                {/* 光晕背景圆 */}
                <div
                  className="absolute h-28 w-28 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(255,200,100,0.4) 0%, transparent 70%)',
                  }}
                />
                <Image
                  alt={prize.name}
                  className="lw-prize-float relative rounded-xl object-cover"
                  height={96}
                  src={prize.image}
                  width={96}
                />
              </div>
            ) : null}
            <p className="relative z-1 mb-1 font-semibold text-lg text-orange-600">
              {prize.name}
            </p>

            {isPhysical ? (
              <p className="relative z-1 mb-6 text-gray-500 text-sm">
                收货信息已登记，我们将联系您安排发货
              </p>
            ) : (
              <p className="relative z-1 mb-6 text-gray-500 text-sm">
                {prize.type === 'virtual' && '虚拟奖品将发送至您的账户'}
                {prize.type === 'coupon' && '优惠券已发放至您的账户'}
                {prize.type === 'points' && '积分已发放至您的账户'}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="lw-prize-float mb-4 inline-block text-5xl">
              &#128591;
            </div>
            <h2 className="mb-2 font-bold text-2xl text-gray-900">谢谢参与</h2>
            <p className="mb-6 text-gray-500 text-sm">{encourageText}</p>
          </>
        )}

        <div className="relative z-1 flex flex-col gap-2.5">
          <button
            className="w-full rounded-full px-6 py-3 font-semibold text-white transition-transform active:scale-[0.98]"
            onClick={onClose}
            style={{
              background: 'linear-gradient(114deg, #FF8D67 0%, #F0361D 100%)',
            }}
            type="button"
          >
            知道了
          </button>

          {/* 中奖时显示"查看我的奖品"按钮 */}
          {isWin && onViewPrizes && (
            <button
              className="w-full rounded-full border border-orange-300 bg-white px-6 py-2.5 font-medium text-orange-500 text-sm transition-transform active:scale-[0.98]"
              onClick={() => {
                onClose();
                onViewPrizes();
              }}
              type="button"
            >
              查看我的奖品
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
