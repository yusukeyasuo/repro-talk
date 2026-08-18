'use client';

import { Check, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logCompositionReps } from '@/app/actions/compositions';
import { Button } from '@/components/ui/button';
import { useTts } from '@/hooks/use-tts';
import { useWakeLock } from '@/hooks/use-wake-lock';
import type { Composition } from '@/types/database';

export type PlayProgress = { index: number; finished: boolean };

type Props = {
  courseId: string;
  courseTitle: string;
  /** すでに順番解決済みの再生列（登録順 or シャッフル済み） */
  sequence: Composition[];
  /** 続きから開始する位置（0 で最初から） */
  startIndex: number;
  intervalSec: number;
  /** ×／完了で抜けるとき、次に再開すべき位置を渡す */
  onExit: (progress: PlayProgress) => void;
};

// TTS 非対応環境で答えを見せておく固定時間
const ANSWER_HOLD_MS = 3500;

export function CompositionPlayer({
  courseId,
  courseTitle,
  sequence,
  startIndex,
  intervalSec,
  onExit,
}: Props) {
  const tts = useTts('en-US');
  const wakeLock = useWakeLock();

  const total = sequence.length;
  const thinkMs = Math.max(3, intervalSec) * 1000;

  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, total - 1)),
  );
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [doneThisRound, setDoneThisRound] = useState(0);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = sequence[index];

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 起動時：解錠（gesture 直後にもう一度）＋ Wake Lock
  useEffect(() => {
    tts.unlock();
    void wakeLock.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      clearTimer();
      tts.cancel();
      void wakeLock.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goNext = useCallback(() => {
    clearTimer();
    // 自然終了（onend）で来たときは speaking=false なので cancel しない。
    // 割り込み（次へ／保険タイマー）で発話中のときだけ止める。無駄な cancel はスタックの元。
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const s = window.speechSynthesis;
      if (s.speaking || s.pending) s.cancel();
    }
    if (index + 1 >= total) {
      setFinished(true);
      void wakeLock.release();
    } else {
      setRevealed(false);
      setIndex(index + 1);
    }
  }, [index, total, clearTimer, wakeLock]);

  // 1文サイクル：考える時間 → 答え表示＋読み上げ＋カウント → 次へ
  useEffect(() => {
    if (finished || total === 0) return;
    // revealed は各遷移（goNext / restart / 初期値）で false 済み。ここでは触らない。
    clearTimer();

    const reveal = () => {
      setRevealed(true);
      setDoneThisRound((n) => n + 1);
      // 1文再生 = 1回完了。都度サーバへ記録するので、途中で止めても数が残る。
      void logCompositionReps({ courseId, repCount: 1 });

      const en = sequence[index]?.en ?? '';
      if (tts.supported) {
        let advanced = false;
        const advance = () => {
          if (advanced) return;
          advanced = true;
          goNext();
        };
        tts.speak(en, { onend: advance });
        const safetyMs = Math.min(20000, Math.max(4000, en.length * 110));
        timerRef.current = setTimeout(advance, safetyMs);
      } else {
        timerRef.current = setTimeout(goNext, ANSWER_HOLD_MS);
      }
    };

    timerRef.current = setTimeout(reveal, thinkMs);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, finished, tts.supported]);

  function restart() {
    clearTimer();
    tts.cancel();
    setDoneThisRound(0);
    setFinished(false);
    setRevealed(false);
    setIndex(0);
    void wakeLock.request();
  }

  function exitNow() {
    clearTimer();
    tts.cancel();
    // 次に再開すべき位置：答えを見た文は完了とみなして次へ、まだなら現在位置。
    const next = finished ? total : revealed ? index + 1 : index;
    onExit({ index: next, finished });
  }

  const overall = total === 0 ? 0 : Math.round(((index + (revealed ? 1 : 0)) / total) * 100);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{courseTitle}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{Math.min(index + 1, total)}</span> /{' '}
            <span className="font-mono tabular-nums">{total}</span>
            <span className="ml-2">
              完了 <span className="font-mono tabular-nums">{doneThisRound}</span>
            </span>
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={exitNow} aria-label="止めて終了">
          <X className="size-5" />
        </Button>
      </div>

      {/* 全体進捗 */}
      <div className="h-1 w-full bg-muted">
        <div
          className="h-full bg-foreground transition-[width] duration-300"
          style={{ width: `${overall}%` }}
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
              <span className="font-mono tabular-nums">{doneThisRound}</span> 文を声に出しました。
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={restart}>
              <RotateCcw className="size-4" />
              もう一周
            </Button>
            <Button onClick={exitNow}>一覧に戻る</Button>
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

          {/* 考える時間ゲージ / 答え */}
          <div className="flex min-h-[4rem] w-full max-w-md flex-col items-center gap-2">
            {revealed ? (
              <p className="font-mono text-xl text-foreground sm:text-2xl">{current?.en}</p>
            ) : (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  {/* key で文が変わるたびにアニメーションを頭から流し直す */}
                  <div
                    key={index}
                    className="h-full origin-left rounded-full bg-foreground"
                    style={{ animation: `composition-drain ${thinkMs}ms linear forwards` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">考える時間</p>
              </>
            )}
          </div>
        </button>
      )}

      {/* フッター */}
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
