'use client';

import { LuckyWheel } from '@lucky-canvas/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/trpc/react';
import { PrizeModal } from './prize-modal';

interface Prize {
  id: string;
  name: string;
  image: string | null;
  type: string;
}

interface WheelContainerProps {
  activityId: string;
  prizes: Prize[];
}

export function WheelContainer({ activityId, prizes }: WheelContainerProps) {
  const wheelRef = useRef<{
    play: () => void;
    stop: (idx: number) => void;
    init: () => void;
  }>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wheelSize, setWheelSize] = useState(340);
  const [spinning, setSpinning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{
    isWin: boolean;
    prize: Prize | null;
  } | null>(null);

  const drawMutation = api.luckyWheel.draw.execute.useMutation();
  const utils = api.useUtils();

  const { data: drawsData } = api.luckyWheel.draw.getRemainingDraws.useQuery({
    activityId,
  });

  // Responsive sizing via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
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
    if (spinning || prizes.length === 0) return;

    setSpinning(true);
    wheelRef.current?.play();

    try {
      const drawResult = await drawMutation.mutateAsync({ activityId });

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
      });

      // Tell wheel where to stop
      wheelRef.current?.stop(idx);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '抽奖失败，请稍后重试';
      toast.error(message);
      wheelRef.current?.stop(0);
      setResult(null);
    }
  }, [spinning, prizes, activityId, drawMutation]);

  const handleEnd = useCallback(() => {
    setSpinning(false);
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
      {drawsData && !drawsData.isUnlimited && (
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
