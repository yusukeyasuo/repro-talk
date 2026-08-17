'use client';

import { Check, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logCompositionReps } from '@/app/actions/compositions';
import { Button } from '@/components/ui/button';
import { useTts } from '@/hooks/use-tts';
import { useWakeLock } from '@/hooks/use-wake-lock';
import type { Composition } from '@/types/database';

export type PlayOrder = 'seq' | 'random';

type Props = {
  courseId: string;
  courseTitle: string;
  compositions: Composition[];
  order: PlayOrder;
  intervalSec: number;
  onExit: () => void;
};

/** Fisher-Yates。ランダム順はプレイヤー内だけで使う（決定性は要らない領域）。 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// TTS 非対応環境で答えを見せておく固定時間
const ANSWER_HOLD_MS = 3500;

export function CompositionPlayer({
  courseId,
  courseTitle,
  compositions,
  order,
  intervalSec,
  onExit,
}: Props) {
  const tts = useTts('en-US');
  const wakeLock = useWakeLock();

  // 開始時に一度だけ並びを固定する
  const [list] = useState(() => (order === 'random' ? shuffle(compositions) : compositions));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [doneCount, setDoneCount] = useState(0); // 完了画面用（ref を render で読まない）

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repsRef = useRef(0); // 読み上げ済み文数
  const flushedRef = useRef(false); // 二重記録の防止

  const total = list.length;
  const current = list[index];

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // run 終了・途中離脱のどちらでも、読み上げた数をまとめて記録する
  const flush = useCallback(() => {
    if (flushedRef.current) return;
    flushedRef.current = true;
    if (repsRef.current > 0) {
      void logCompositionReps({ courseId, repCount: repsRef.current });
    }
  }, [courseId]);

  // 起動時：iOS 解錠 ＋ Wake Lock
  useEffect(() => {
    // StrictMode（dev）はマウントを2回走らせ、間の cleanup で flush() が走って
    // flushedRef が立ってしまう。マウントのたびに戻して本番の記録を落とさない。
    flushedRef.current = false;
    tts.unlock();
    void wakeLock.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アンマウント時（＝途中離脱を含む）に必ず後始末と記録
  useEffect(() => {
    return () => {
      clearTimer();
      tts.cancel();
      void wakeLock.release();
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goNext = useCallback(() => {
    clearTimer();
    tts.cancel();
    if (index + 1 >= total) {
      setFinished(true);
      setDoneCount(repsRef.current);
      void wakeLock.release();
      flush();
    } else {
      setRevealed(false);
      setIndex(index + 1);
    }
  }, [index, total, clearTimer, tts, wakeLock, flush]);

  // 1文ぶんのサイクル：考える時間 → 答え表示＋読み上げ → 次へ
  useEffect(() => {
    if (finished || total === 0) return;
    // revealed は各遷移（goNext / restart / 初期値）で false 済みなので、ここでは触らない
    clearTimer();

    timerRef.current = setTimeout(
      () => {
        setRevealed(true);
        repsRef.current += 1;
        const en = list[index]?.en ?? '';

        if (tts.supported) {
          let advanced = false;
          const advance = () => {
            if (advanced) return;
            advanced = true;
            goNext();
          };
          tts.speak(en, { onend: advance });
          // onend が来ない/遅い環境向けの保険。読み上げを途中で切らないよう長めに見積もる
          // （英語 TTS は概ね 12〜15 字/秒。onend が来れば即送りなのでこれは上限）。
          const safetyMs = Math.min(20000, Math.max(4000, en.length * 110));
          timerRef.current = setTimeout(advance, safetyMs);
        } else {
          timerRef.current = setTimeout(goNext, ANSWER_HOLD_MS);
        }
      },
      Math.max(3, intervalSec) * 1000,
    );

    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, finished, tts.supported]);

  function restart() {
    clearTimer();
    tts.cancel();
    flushedRef.current = false;
    repsRef.current = 0;
    setDoneCount(0);
    setFinished(false);
    setRevealed(false);
    setIndex(0);
    void wakeLock.request();
  }

  const progress = total === 0 ? 0 : Math.round(((index + (revealed ? 1 : 0)) / total) * 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{courseTitle}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {Math.min(index + 1, total)}
            </span>{' '}
            / <span className="font-mono tabular-nums">{total}</span>
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onExit} aria-label="やめる">
          <X className="size-5" />
        </Button>
      </div>

      {/* 進捗バー */}
      <div className="h-1 w-full bg-muted">
        <div
          className="h-full bg-foreground transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 本体 */}
      {finished ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-accent">
            <Check className="size-7" />
          </div>
          <div>
            <p className="text-lg font-medium">1周おつかれさまでした</p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono tabular-nums">{doneCount}</span> 文を声に出しました。
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={restart}>
              <RotateCcw className="size-4" />
              もう一周
            </Button>
            <Button onClick={onExit}>一覧に戻る</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={goNext}
          className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-8 px-6 text-center"
          aria-label="次へ"
        >
          {/* 日本語（font-mono に入れない＝豆腐対策） */}
          <p className="max-w-2xl text-2xl leading-relaxed sm:text-3xl">{current?.ja}</p>

          {/* 答え（英語） */}
          <div className="min-h-[3.5rem]">
            {revealed ? (
              <p className="max-w-2xl font-mono text-xl text-foreground sm:text-2xl">
                {current?.en}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                声に出してから、答えを待つ
              </p>
            )}
          </div>
        </button>
      )}

      {/* フッター操作 */}
      {!finished && (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {tts.supported ? '答えは自動で読み上げます' : 'この端末は読み上げ非対応（表示のみ）'}
          </p>
          <Button variant="outline" size="sm" onClick={goNext}>
            次へ
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
