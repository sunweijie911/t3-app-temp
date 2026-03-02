'use client';

import Image from 'next/image';

interface PrizeModalProps {
  open: boolean;
  onClose: () => void;
  isWin: boolean;
  prize: {
    name: string;
    image: string | null;
    type: string;
  } | null;
}

export function PrizeModal({ open, onClose, isWin, prize }: PrizeModalProps) {
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
        {/* Close button */}
        <button
          aria-label="关闭"
          className="absolute top-3 right-3 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-black/20 text-white transition-opacity hover:bg-black/30"
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
            <div className="lw-prize-float mb-4 inline-block text-5xl">
              &#127881;
            </div>
            <h2 className="mb-2 font-bold text-2xl text-gray-900">
              恭喜中奖！
            </h2>
            {prize.image && (
              <Image
                alt={prize.name}
                className="lw-prize-float mx-auto mb-4 rounded-xl object-cover"
                height={96}
                src={prize.image}
                width={96}
              />
            )}
            <p className="mb-1 font-semibold text-lg text-orange-600">
              {prize.name}
            </p>

            {isPhysical ? (
              <p className="mb-6 text-gray-500 text-sm">
                收货信息已登记，我们将联系您安排发货 ✅
              </p>
            ) : (
              <p className="mb-6 text-gray-500 text-sm">
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
            <p className="mb-6 text-gray-500 text-sm">
              很遗憾没有中奖，下次再来试试吧！
            </p>
          </>
        )}

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
      </div>
    </div>
  );
}
