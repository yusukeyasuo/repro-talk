'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { loadYouTubeIframeApi, PLAYER_STATE, type YTPlayer } from '@/lib/youtube-iframe';

export type PlayerHandle = {
  /** 指定区間を再生する。loop が true なら end に達したら start へ戻す。 */
  playRange(startSec: number, endSec: number, loop?: boolean): void;
  pause(): void;
  stop(): void;
  seekTo(sec: number): void;
  setRate(rate: number): void;
  getCurrentTime(): number;
  isReady(): boolean;
};

type Props = {
  ref?: React.Ref<PlayerHandle>;
  videoId: string;
  /** 再生位置の通知（区間内かどうかの表示に使う） */
  onTime?: (sec: number) => void;
  /** loop=false で区間の終端に達したとき。「1文再生 → 止める」の要。 */
  onRangeEnd?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  className?: string;
};

/**
 * IFrame Player API のラッパ。
 * end パラメータはループしないので requestAnimationFrame で終端を監視する。
 */
export function YouTubePlayer({
  ref,
  videoId,
  onTime,
  onRangeEnd,
  onPlayingChange,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const rafRef = useRef<number | null>(null);
  const rangeRef = useRef<{ start: number; end: number; loop: boolean } | null>(null);
  const rateRef = useRef(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 最新のコールバックを ref 経由で参照し、再購読を避ける
  const onTimeRef = useRef(onTime);
  const onRangeEndRef = useRef(onRangeEnd);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onTimeRef.current = onTime;
    onRangeEndRef.current = onRangeEnd;
    onPlayingChangeRef.current = onPlayingChange;
  });

  const stopWatching = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startWatching = useCallback(() => {
    stopWatching();
    const tick = () => {
      const player = playerRef.current;
      if (!player) return;

      let current = 0;
      try {
        current = player.getCurrentTime();
      } catch {
        return;
      }
      onTimeRef.current?.(current);

      const range = rangeRef.current;
      if (range && current >= range.end) {
        if (range.loop) {
          player.seekTo(range.start, true);
        } else {
          player.pauseVideo();
          rangeRef.current = null;
          onPlayingChangeRef.current?.(false);
          onRangeEndRef.current?.();
          stopWatching();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopWatching]);

  useEffect(() => {
    let disposed = false;
    // YT.Player は渡した要素を iframe で「置き換える」ので、React が持つ ref を
    // 直接渡すと再マウント時に参照が外れる。使い捨ての子要素を挟む。
    const host = hostRef.current;
    const mount = document.createElement('div');
    host?.appendChild(mount);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed) return;
        playerRef.current = new YT.Player(mount, {
          videoId,
          playerVars: {
            // モバイルで全画面に奪われないように
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: 1,
          },
          events: {
            onReady: () => {
              if (!disposed) setReady(true);
            },
            onStateChange: (event) => {
              const playing = event.data === PLAYER_STATE.PLAYING;
              onPlayingChangeRef.current?.(playing);
              if (playing) startWatching();
              else if (event.data !== PLAYER_STATE.BUFFERING) stopWatching();
            },
            onError: () => {
              if (!disposed) setError('この動画は埋め込み再生できません');
            },
          },
        });
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      });

    return () => {
      disposed = true;
      stopWatching();
      try {
        playerRef.current?.destroy();
      } catch {
        // 破棄済みなら無視
      }
      playerRef.current = null;
      // destroy() が iframe を消し損ねた場合に備えて掃除する
      if (host) host.innerHTML = '';
    };
  }, [videoId, startWatching, stopWatching]);

  useImperativeHandle(
    ref,
    (): PlayerHandle => ({
      playRange(startSec, endSec, loop = false) {
        const player = playerRef.current;
        if (!player) return;
        rangeRef.current = { start: startSec, end: endSec, loop };
        player.seekTo(startSec, true);
        player.setPlaybackRate(rateRef.current);
        player.playVideo();
        startWatching();
      },
      pause() {
        rangeRef.current = null;
        playerRef.current?.pauseVideo();
        stopWatching();
      },
      stop() {
        rangeRef.current = null;
        playerRef.current?.stopVideo();
        stopWatching();
      },
      seekTo(sec) {
        playerRef.current?.seekTo(sec, true);
      },
      setRate(rate) {
        rateRef.current = rate;
        playerRef.current?.setPlaybackRate(rate);
      },
      getCurrentTime() {
        try {
          return playerRef.current?.getCurrentTime() ?? 0;
        } catch {
          return 0;
        }
      },
      isReady: () => ready,
    }),
    [ready, startWatching, stopWatching],
  );

  return (
    <div className={className}>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        {/* YT が差し込む iframe は 640x360 固定なので、子孫セレクタで埋めさせる */}
        <div
          ref={hostRef}
          className="absolute inset-0 size-full [&>iframe]:size-full [&>iframe]:border-0"
        />
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            プレイヤーを読み込み中…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
