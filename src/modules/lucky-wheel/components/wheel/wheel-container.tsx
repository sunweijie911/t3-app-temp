'use client';

import { LuckyWheel } from '@lucky-canvas/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/trpc/react';
import { PrizeModal } from './prize-modal';

export interface Prize {
  id: string;
  name: string;
  image: string | null;
  type: string;
}

interface WheelContainerProps {
  activityId: string;
  prizes: Prize[];
  isLoggedIn: boolean;
  name?: string;
  address?: string;
  onViewPrizes?: () => void;
}

export function WheelContainer({
  activityId,
  prizes,
  isLoggedIn,
  name,
  address,
  onViewPrizes,
}: WheelContainerProps) {
  const wheelRef = useRef<{
    play: () => void;
    stop: (idx: number) => void;
    init: () => void;
  }>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wheelSize, setWheelSize] = useState(340);
  const [spinning, setSpinning] = useState(false);
  // 用 ref 同步跟踪旋转状态，供 ResizeObserver 回调读取（避免闭包旧值）
  const spinningRef = useRef(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{
    isWin: boolean;
    prize: Prize | null;
    recordId: string | null;
  } | null>(null);

  const drawMutation = api.luckyWheel.draw.execute.useMutation();
  const utils = api.useUtils();

  const { data: drawsData } = api.luckyWheel.draw.getRemainingDraws.useQuery(
    { activityId },
    { enabled: isLoggedIn },
  );

  // Responsive sizing via ResizeObserver
  // 旋转期间跳过 resize 更新，防止 key 变化触发重挂载导致 onEnd 不触发、spinning 卡死
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      if (spinningRef.current) return;
      const w = el.clientWidth;
      setWheelSize(Math.min(360, Math.floor(w * 0.9)));
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 奖品扇区配置 — 深浅交替暖色
  const lcPrizes = prizes.map((p, i) => ({
    background: i % 2 === 0 ? '#ffd099' : '#fff',
    fonts: [
      {
        text: p.name,
        top: '10%',
        fontSize: '14px',
      },
    ],
    ...(p.image ? { imgs: [{ src: p.image, top: '40%', width: '30%' }] } : {}),
  }));

  // 外圈装饰 — 暖橙色带灯珠圆环图片
  // padding 需匹配图片圆环的视觉宽度，避免内侧遮挡扇区
  const blocks = [
    {
      padding: '36px',
      imgs: [
        {
          src: '/lucky-wheel/wheel-frame.png',
          width: '100%',
          height: '100%',
          top: '5px',
          left: '3px',
        },
      ],
    },
  ];

  // 中心按钮 — 带指针的"开始抽奖"图片
  const buttons = [
    {
      radius: '45px',
      imgs: [
        {
          src: '/lucky-wheel/wheel-button.png',
          width: '100%',
          top: '-127%',
        },
      ],
    },
  ];

  const defaultConfig = {
    speed: 20,
    accelerationTime: 2500,
    decelerationTime: 3500,
    offsetDegree: prizes.length > 0 ? -(360 / prizes.length / 2) : 0,
  };

  const defaultStyle = {
    fontColor: '#913229',
    fontSize: '15px',
    fontWeight: '700',
  };

  const handleStart = useCallback(async () => {
    if (!isLoggedIn) {
      // Should not reach here — UserInfoModal guards this path
      return;
    }

    if (spinning || prizes.length === 0) return;

    setSpinning(true);
    spinningRef.current = true;
    wheelRef.current?.play();

    try {
      const drawResult = await drawMutation.mutateAsync({
        activityId,
        address,
        name,
      });

      // Find the target index
      let idx = 0;
      if (drawResult.isWin && drawResult.prize) {
        const prizeIdx = prizes.findIndex((p) => p.id === drawResult.prize?.id);
        if (prizeIdx >= 0) idx = prizeIdx;
      } else {
        const thanksIdx = prizes.findIndex((p) => p.type === 'thanks');
        idx =
          thanksIdx >= 0
            ? thanksIdx
            : Math.floor(Math.random() * prizes.length);
      }

      setResult({
        isWin: drawResult.isWin,
        prize: drawResult.prize as Prize | null,
        recordId: drawResult.recordId,
      });

      // Tell wheel where to stop
      wheelRef.current?.stop(idx);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '抽奖失败，请稍后重试';
      toast.error(message);
      // Stop at thanks slot if available to avoid misleading visual
      const thanksIdx = prizes.findIndex((p) => p.type === 'thanks');
      wheelRef.current?.stop(
        thanksIdx >= 0 ? thanksIdx : Math.floor(Math.random() * prizes.length),
      );
      setResult(null);
    }
  }, [isLoggedIn, spinning, prizes, activityId, name, address, drawMutation]);

  const handleEnd = useCallback(() => {
    setSpinning(false);
    spinningRef.current = false;
    // Refresh remaining draws count after each draw
    void utils.luckyWheel.draw.getRemainingDraws.invalidate();
    if (result) {
      setModalOpen(true);
    }
  }, [result, utils]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setResult(null);
  }, []);

  return (
    <div className="flex flex-col items-center gap-5" ref={containerRef}>
      <LuckyWheel
        blocks={blocks}
        buttons={buttons}
        defaultConfig={defaultConfig}
        defaultStyle={defaultStyle}
        height={wheelSize}
        key={wheelSize}
        onEnd={handleEnd}
        onStart={handleStart}
        prizes={lcPrizes}
        ref={wheelRef}
        width={wheelSize}
      />

      {/* 胶囊样式抽奖次数展示 — 始终渲染占位，数据到达后淡入 */}
      {isLoggedIn && (
        <div
          className="flex items-center gap-1.5 rounded-full px-5 py-2 text-sm text-white shadow-md transition-opacity duration-300"
          style={{
            opacity: drawsData && !drawsData.isUnlimited ? 1 : 0,
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.1) 100%)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.3)',
          }}
        >
          剩余抽奖次数：
          <span className="font-extrabold text-base text-yellow-200">
            {drawsData?.remaining ?? 0}
          </span>
        </div>
      )}

      <PrizeModal
        isWin={result?.isWin ?? false}
        onClose={handleModalClose}
        onViewPrizes={onViewPrizes}
        open={modalOpen}
        prize={result?.prize ?? null}
      />
    </div>
  );
}
