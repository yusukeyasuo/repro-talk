'use client';

import { Check, ChevronRight, Eye, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logCompositionReps } from '@/app/actions/compositions';
import { Button } from '@/components/ui/button';
import { useWakeLock } from '@/hooks/use-wake-lock';
import * as speaker from '@/lib/speaker';
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

export function CompositionPlayer({
  courseId,
  courseTitle,
  sequence,
  startIndex,
  intervalSec,
  onExit,
}: Props) {
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock();

  const total = sequence.length;
  const thinkMs = Math.max(3, intervalSec) * 1000;

  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, total - 1)),
  );
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [doneThisRound, setDoneThisRound] = useState(0);
  const [paused, setPaused] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // revealed / paused は setState が非同期なので、タイマー・onend の割り込み判定は ref（同期）で見る。
  const revealedRef = useRef(false);
  const pausedRef = useRef(false);
  // 現タイマーの締切（performance.now 基準）と、一時停止時に保存する残り時間。
  const deadlineRef = useRef(0);
  const remainingRef = useRef(0);

  const current = sequence[index];

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 再生を止める（<audio> と、フォールバックの speechSynthesis の両方）。
  const stopSpeaking = useCallback(() => {
    speaker.cancel();
  }, []);

  // タイマーを張る。締切を控えておき、一時停止で残り時間を割り出せるようにする。
  const arm = useCallback(
    (ms: number, cb: () => void) => {
      clearTimer();
      deadlineRef.current = performance.now() + ms;
      timerRef.current = setTimeout(cb, ms);
    },
    [clearTimer],
  );

  const goNext = useCallback(() => {
    clearTimer();
    stopSpeaking();
    revealedRef.current = false;
    if (index + 1 >= total) {
      setFinished(true);
      void releaseWakeLock();
    } else {
      setRevealed(false);
      setIndex(index + 1);
    }
  }, [index, total, clearTimer, stopSpeaking, releaseWakeLock]);

  // 答えフェーズ：現在の英語を読み上げ、onend／保険タイマーで次へ送る。
  const runAnswer = useCallback(() => {
    const en = sequence[index]?.en ?? '';
    let advanced = false;
    const advance = () => {
      if (advanced || pausedRef.current) return; // 一時停止中の割り込みでは送らない
      advanced = true;
      goNext();
    };
    speaker.speak(en, { onend: advance });
    // onend が来ない/遅い環境向けの保険。クラウド音声の読み込み待ちも見込んで長めに。
    const safetyMs = Math.min(20000, Math.max(6000, en.length * 110));
    arm(safetyMs, advance);
  }, [sequence, index, arm, goNext]);

  // 考える時間が尽きた／タップされたときに1回だけ答えを出す。連打での二重 log を revealedRef で防ぐ。
  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setRevealed(true);
    setDoneThisRound((n) => n + 1);
    // 1文表示 = 1回完了。都度サーバへ記録するので、途中で止めても数が残る。
    void logCompositionReps({ courseId, repCount: 1 });
    runAnswer();
  }, [courseId, runAnswer]);

  // 考えるフェーズ：残り時間ぶんだけ待って reveal する。
  const runThink = useCallback((ms: number) => arm(ms, reveal), [arm, reveal]);

  // 起動時：解錠（gesture 直後にもう一度）＋ Wake Lock
  useEffect(() => {
    speaker.unlock();
    void requestWakeLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      clearTimer();
      speaker.cancel();
      void releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 考える時間のあいだに、今の文と次の文の音声URLを先に取っておく（体感遅延を消す）。
  useEffect(() => {
    if (finished || total === 0) return;
    speaker.prefetch(sequence[index]?.en ?? '');
    speaker.prefetch(sequence[index + 1]?.en ?? '');
  }, [index, finished, total, sequence]);

  // 1文サイクルの起点：新しい文（index 変化）ごとに考えるフェーズを張る。
  // 答えフェーズに入った後（revealedRef=true）は再アームしない＝この effect は文の開始だけを担う。
  useEffect(() => {
    if (finished || total === 0) return;
    if (revealedRef.current) return;
    runThink(thinkMs);
    return clearTimer;
  }, [runThink, thinkMs, finished, total, clearTimer]);

  function onTap() {
    if (paused) {
      resume();
      return;
    }
    if (!revealedRef.current) reveal(); // 考える時間中：今すぐ答えを表示＋読み上げ→自動で次へ
    else goNext(); // 答え表示中：もう次へ
  }

  function pause() {
    pausedRef.current = true;
    setPaused(true);
    remainingRef.current = Math.max(0, deadlineRef.current - performance.now());
    clearTimer();
    stopSpeaking();
    void releaseWakeLock();
  }

  function resume() {
    pausedRef.current = false;
    setPaused(false);
    void requestWakeLock();
    if (revealedRef.current) {
      runAnswer(); // 答えは頭から読み直す（speechSynthesis の pause/resume は端末差が大きく不安定）
    } else {
      runThink(remainingRef.current > 0 ? remainingRef.current : thinkMs); // 止めた位置から続き
    }
  }

  function togglePause() {
    if (paused) resume();
    else pause();
  }

  function restart() {
    clearTimer();
    speaker.cancel();
    pausedRef.current = false;
    revealedRef.current = false;
    setPaused(false);
    setDoneThisRound(0);
    setFinished(false);
    setRevealed(false);
    setIndex(0);
    void requestWakeLock();
  }

  function exitNow() {
    clearTimer();
    speaker.cancel();
    // 次に再開すべき位置：答えを見た文は完了とみなして次へ、まだなら現在位置。
    const next = finished ? total : revealedRef.current ? index + 1 : index;
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
        <div className="flex shrink-0 items-center gap-1">
          {!finished && (
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePause}
              aria-label={paused ? '再開' : '一時停止'}
            >
              {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={exitNow} aria-label="止めて終了">
            <X className="size-5" />
          </Button>
        </div>
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
          onClick={onTap}
          className="relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-8 px-6 text-center"
          aria-label={paused ? '再開' : revealed ? '次へ' : '答えを見る'}
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
                  {/* key で文が変わるたびにアニメーションを頭から流し直す。一時停止は
                      再マウントせず animation-play-state を止める＝凍結位置から再開できる。 */}
                  <div
                    key={index}
                    className="h-full origin-left rounded-full bg-foreground"
                    style={{
                      animation: `composition-drain ${thinkMs}ms linear forwards`,
                      animationPlayState: paused ? 'paused' : 'running',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">考える時間</p>
              </>
            )}
          </div>

          {/* 一時停止オーバーレイ。ボタンの入れ子を避けるため中は div のみ＝タップは親へ届き再開する。 */}
          {paused && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/95">
              <div className="grid size-14 place-items-center rounded-full bg-accent">
                <Pause className="size-7" />
              </div>
              <div>
                <p className="text-lg font-medium">一時停止中</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  画面をタップすると続きから再開します
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium">
                <Play className="size-4" />
                再開
              </span>
            </div>
          )}
        </button>
      )}

      {/* フッター */}
      {!finished && (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">答えは自動で読み上げます</p>
          <Button variant="outline" size="sm" onClick={onTap} disabled={paused}>
            {revealed ? (
              <>
                次へ
                <ChevronRight className="size-4" />
              </>
            ) : (
              <>
                <Eye className="size-4" />
                答えを見る
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
