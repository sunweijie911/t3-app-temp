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
}

export function WheelContainer({
  activityId,
  prizes,
  isLoggedIn,
  name,
  address,
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
      setWheelSize(Math.min(340, Math.floor(w * 0.85)));
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build lucky-canvas config from prizes — warm alternating colors
  const lcPrizes = prizes.map((p, i) => ({
    background: i % 2 === 0 ? '#FFE5D9' : '#FFF4E6',
    fonts: [
      {
        text: p.name,
        top: '10%',
        fontColor: i % 2 === 0 ? '#FF6B3D' : '#FF8C42',
        fontSize: '13px',
        fontWeight: 'bold',
        wordWrap: true,
        lengthLimit: '80%',
        lineClamp: 2,
      },
    ],
    ...(p.image ? { imgs: [{ src: p.image, top: '40%', width: '30%' }] } : {}),
  }));

  const blocks = [
    { padding: '13px', background: '#FFA04B' },
    { padding: '5px', background: '#FFD4A8' },
  ];

  const buttons = [
    {
      radius: '25%',
      background: '#FF6B3D',
      pointer: true,
      fonts: [
        { text: '抽奖', top: '-10px', fontColor: '#fff', fontSize: '18px' },
      ],
    },
  ];

  const defaultConfig = {
    speed: 20,
    accelerationTime: 2500,
    decelerationTime: 3500,
    offsetDegree: 30,
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
    <div className="flex flex-col items-center gap-4" ref={containerRef}>
      <LuckyWheel
        blocks={blocks}
        buttons={buttons}
        defaultConfig={defaultConfig}
        height={wheelSize}
        key={wheelSize}
        onEnd={handleEnd}
        onStart={handleStart}
        prizes={lcPrizes}
        ref={wheelRef}
        width={wheelSize}
      />

      {/* Remaining draws hint */}
      {isLoggedIn && drawsData && !drawsData.isUnlimited && (
        <p className="text-sm text-white/90">
          剩余抽奖次数：
          <span className="font-bold text-white">{drawsData.remaining}</span>
        </p>
      )}

      <PrizeModal
        isWin={result?.isWin ?? false}
        onClose={handleModalClose}
        open={modalOpen}
        prize={result?.prize ?? null}
      />
    </div>
  );
}
