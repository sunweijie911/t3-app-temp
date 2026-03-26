'use client';

import { useEffect } from 'react';

/**
 * 通过 URL 参数 `?debug=true` 开启 vConsole 调试面板。
 * 用于钉钉 H5 微应用内调试。
 */
export function useVConsole() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') !== 'true') return;

    let instance: { destroy: () => void } | undefined;
    void import('vconsole').then(({ default: VConsole }) => {
      instance = new VConsole();
    });

    return () => {
      instance?.destroy();
    };
  }, []);
}
