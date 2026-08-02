'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

/**
 * 「1人電話」は歩きながら画面を点けたまま話す前提。
 * バックグラウンド録音はできないので、スリープを止めないと録音が切れる。
 */
export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const [active, setActive] = useState(false);
  // SSR とのハイドレーション差分を作らないよう、実際に request() したときに判定する
  const [supported, setSupported] = useState(true);

  const request = useCallback(async () => {
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) {
      setSupported(false);
      return;
    }
    try {
      const sentinel = await nav.wakeLock.request('screen');
      sentinel.addEventListener('release', () => setActive(false));
      sentinelRef.current = sentinel;
      setActive(true);
    } catch {
      setActive(false);
    }
  }, []);

  const release = useCallback(async () => {
    try {
      await sentinelRef.current?.release();
    } catch {
      // 既に解放済み
    }
    sentinelRef.current = null;
    setActive(false);
  }, []);

  // タブに戻ってきたら取り直す（OS が勝手に解放するため）
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'visible' && sentinelRef.current === null && active) {
        void request();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, request]);

  useEffect(() => {
    return () => {
      void sentinelRef.current?.release();
    };
  }, []);

  return { active, supported, request, release };
}
