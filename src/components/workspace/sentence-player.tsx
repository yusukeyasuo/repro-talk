'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getTtsUrl, prefetch } from '@/lib/speaker';

// preservesPitch は比較的新しい標準プロパティ。lib の版差で型が無くても壊れないよう緩く扱う。
type PitchAudio = HTMLAudioElement & { preservesPitch?: boolean };

export type SentencePlayerHandle = {
  /** 現在の文を再生する。loop=true なら鳴らし終えるたびに同じ文を鳴らし直す。 */
  play(opts?: { loop?: boolean }): void;
  pause(): void;
  setRate(rate: number): void;
};

type Props = {
  ref?: React.Ref<SentencePlayerHandle>;
  /** 文単位に分割済みのスクリプト */
  sentences: string[];
  /** いま練習している文のインデックス */
  index: number;
  rate: number;
  onIndexChange: (index: number) => void;
  /** loop=false で現在の文を鳴らし終えたとき。「1文再生 → 止める」の要。 */
  onSentenceEnd: () => void;
  onPlayingChange: (playing: boolean) => void;
};

/**
 * 自作テキストのリプロダクション用プレイヤー。動画の代わりにクラウドTTSを鳴らす。
 * 速度は <audio>.playbackRate（preservesPitch）で変え、TTS を速度別に再生成しない。
 */
export function SentencePlayer({
  ref,
  sentences,
  index,
  rate,
  onIndexChange,
  onSentenceEnd,
  onPlayingChange,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const loopRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = sentences.length;
  const current = sentences[index] ?? '';

  // 最新のコールバックを ref 経由で参照して再購読を避ける
  const onSentenceEndRef = useRef(onSentenceEnd);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onSentenceEndRef.current = onSentenceEnd;
    onPlayingChangeRef.current = onPlayingChange;
  });

  // 体感遅延を消すため、次の文の音声URLを先読みしておく
  useEffect(() => {
    const next = sentences[index + 1];
    if (next) prefetch(next);
  }, [sentences, index]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        // 無視
      }
    }
  }, []);

  const playCurrent = useCallback(
    async (loop: boolean) => {
      const a = audioRef.current;
      const text = sentences[index];
      if (!a || !text) return;
      loopRef.current = loop;
      setError(null);
      onPlayingChangeRef.current(true); // 楽観的にボタンを反応させる
      setLoading(true);
      const url = await getTtsUrl(text);
      setLoading(false);
      if (!url) {
        onPlayingChangeRef.current(false);
        setError('音声を用意できませんでした（クラウドTTSが未設定かもしれません）');
        return;
      }
      try {
        a.src = url;
        a.currentTime = 0;
        a.playbackRate = rate;
        (a as PitchAudio).preservesPitch = true;
        await a.play();
      } catch {
        onPlayingChangeRef.current(false);
        setError('再生できませんでした');
      }
    },
    [sentences, index, rate],
  );

  useImperativeHandle(
    ref,
    (): SentencePlayerHandle => ({
      play({ loop = false } = {}) {
        void playCurrent(loop);
      },
      pause() {
        stop();
        onPlayingChangeRef.current(false);
      },
      setRate(r) {
        if (audioRef.current) audioRef.current.playbackRate = r;
      },
    }),
    [playCurrent, stop],
  );

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{total === 0 ? 0 : index + 1}</span> /{' '}
          <span className="font-mono tabular-nums">{total}</span> 文
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="前の文へ"
            disabled={index <= 0}
            onClick={() => onIndexChange(index - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="次の文へ"
            disabled={index >= total - 1}
            onClick={() => onIndexChange(index + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-28 place-items-center rounded-md bg-muted/40 p-4">
        {current ? (
          <p className="text-center text-lg leading-relaxed">{current}</p>
        ) : (
          <p className="text-sm text-muted-foreground">本文がありません。「本文を編集」から入れてください。</p>
        )}
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => {
          if (loopRef.current) {
            void playCurrent(true);
            return;
          }
          onPlayingChangeRef.current(false);
          onSentenceEndRef.current();
        }}
        onError={() => {
          onPlayingChangeRef.current(false);
          setError('再生できませんでした');
        }}
      />

      {loading && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          音声を用意中…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
