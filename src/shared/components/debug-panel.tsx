'use client';

import type { Eruda } from 'eruda';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

// 模块兼容：webpack 可能把 eruda 放在 default 上，也可能直接是模块本身
function loadEruda(): Promise<Eruda> {
  return import('eruda').then(
    (mod) =>
      (mod as unknown as { default: Eruda }).default ??
      (mod as unknown as Eruda),
  );
}

/**
 * 移动端调试面板。
 * 任意前台页面 URL 加 ?debug=true 即可唤出 Eruda 调试面板。
 */
export function DebugPanel() {
  const searchParams = useSearchParams();
  const enabled = searchParams.get('debug') === 'true';
  const initializedRef = useRef(false);

  useEffect(() => {
    if (enabled && !initializedRef.current) {
      initializedRef.current = true;
      void loadEruda().then((eruda) => eruda.init());
    }

    if (!enabled && initializedRef.current) {
      initializedRef.current = false;
      void loadEruda().then((eruda) => eruda.destroy());
    }
  }, [enabled]);

  return null;
}
