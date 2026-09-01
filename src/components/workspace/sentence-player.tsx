'use client';

import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { AnnotatedText } from '@/components/annotation/annotated-text';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { getTtsUrl, prefetch } from '@/lib/speaker';
import type { Sentence } from '@/lib/transcript';
import type { Annotation } from '@/types/annotation';

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
  /** 文単位に分割済みのスクリプト。オフセットは transcript 基準。 */
  sentences: Sentence[];
  /** 記号の参照元。オフセットがこれに対する位置なので、切り出さずそのまま渡す。 */
  transcript: string;
  /** 音の記号。いま出している文にかかっている分だけを描く。 */
  annotations: Annotation[];
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
  transcript,
  annotations,
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
  // 「慣れたら耳だけ」に戻れるよう、記号は畳める
  const [showMarks, setShowMarks] = useState(true);

  const total = sentences.length;
  const current = sentences[index];

  // この文にかかっている記号だけ数える（無い文では切り替えを出さない）
  const marksHere = useMemo(() => {
    if (!current) return 0;
    return annotations.filter((a) => a.start < current.end && a.end > current.start).length;
  }, [annotations, current]);

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
    if (next) prefetch(next.text);
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
      const text = sentences[index]?.text;
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
          showMarks && marksHere > 0 ? (
            // 記号は transcript の文字インデックスなので、文を切り出さず range で絞る
            <AnnotatedText
              text={transcript}
              annotations={annotations}
              range={{ start: current.start, end: current.end }}
              className="space-y-0 text-center text-lg leading-[2.4]"
            />
          ) : (
            <p className="text-center text-lg leading-relaxed">{current.text}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">本文がありません。「本文を編集」から入れてください。</p>
        )}
      </div>

      {marksHere > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {showMarks
              ? '解析した音の記号を重ねています。'
              : '記号を隠しています。耳だけで再現してみるとき用。'}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setShowMarks((v) => !v)}>
            {showMarks ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {showMarks ? '記号を隠す' : '記号を出す'}
          </Button>
        </div>
      )}

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
          <Spinner className="size-3.5" />
          音声を用意中…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
