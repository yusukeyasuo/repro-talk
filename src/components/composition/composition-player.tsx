'use client';

import { Check, ChevronRight, Eye, Pause, Play, RotateCcw, Star, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { logCompositionReps, updateComposition } from '@/app/actions/compositions';
import { Button } from '@/components/ui/button';
import { useWakeLock } from '@/hooks/use-wake-lock';
import * as speaker from '@/lib/speaker';
import { cn } from '@/lib/utils';
import type { Composition } from '@/types/database';

export type PlayProgress = { index: number; finished: boolean };

// 読み上げが終わったあと、声に出して再現するための間。ここが尽きると次の文へ送る。
// タップすれば待たずに次へ行けるので、迷ったら少し長めでよい。
const REPRODUCE_PAUSE_MS = 3000;

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
  // 読み上げ後の「声に出して再現する間」に入っているか（ゲージ・ラベルの出し分け用）。
  const [reproducing, setReproducing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [doneThisRound, setDoneThisRound] = useState(0);
  const [paused, setPaused] = useState(false);
  // ★（重点マーク）の楽観状態。ドリル中に「言えなかった」文へその場で付け外しできる。
  // 退出時の router.refresh（CourseScreen 側）でサーバ値へ寄せ直る。
  const [starredIds, setStarredIds] = useState<Set<string>>(
    () => new Set(sequence.filter((c) => c.starred).map((c) => c.id)),
  );

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
    setReproducing(false);
    if (index + 1 >= total) {
      setFinished(true);
      void releaseWakeLock();
    } else {
      setRevealed(false);
      setIndex(index + 1);
    }
  }, [index, total, clearTimer, stopSpeaking, releaseWakeLock]);

  // 答えフェーズ：現在の英語を読み上げ、読み終えたら「再現の間」を挟んでから次へ送る。
  const runAnswer = useCallback(() => {
    const en = sequence[index]?.en ?? '';
    setReproducing(false); // 読み上げ中はまだ再現フェーズではない（resume での読み直しでも戻す）
    let toReproduce = false;
    // 読み上げ完了（onend／保険タイマー）→ 声に出して再現する間をとってから次へ。
    const startReproduce = () => {
      if (toReproduce || pausedRef.current) return; // 一時停止中の割り込みでは進めない
      toReproduce = true;
      setReproducing(true);
      arm(REPRODUCE_PAUSE_MS, goNext);
    };
    speaker.speak(en, { onend: startReproduce });
    // onend が来ない/遅い環境向けの保険。クラウド音声の読み込み待ちも見込んで長めに。
    const safetyMs = Math.min(20000, Math.max(6000, en.length * 110));
    arm(safetyMs, startReproduce);
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

  // 送り（フッターのボタン専用）。画面の真ん中は一時停止に割り当てたので、送りはここだけが担う。
  // 一時停止したまま送ると無音で止まったままになるので、送るときは必ず止まりを解く。
  function advance() {
    // 最後の1文を送ると完了画面へ抜ける。そこでは画面を点けておく必要がないので取り直さない
    // （goNext 側の release と競って、取り直しだけが後から効いてしまうのを防ぐ）。
    const willFinish = revealedRef.current && index + 1 >= total;
    if (pausedRef.current) clearPaused(!willFinish);
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

  // 止まっている状態だけ解く（タイマーは張り直さない）。送りの前処理としても使う。
  function clearPaused(reacquireWakeLock = true) {
    pausedRef.current = false;
    setPaused(false);
    if (reacquireWakeLock) void requestWakeLock();
  }

  function resume() {
    clearPaused();
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

  // ★のトグル。ヘッダーに置くので全画面タップ（次へ）とは別の当たり判定。
  // トグルのみで、答え表示にも次への送りにも一切繋げない（タイマーにも触れない）。
  function toggleStar() {
    const c = sequence[index];
    if (!c) return;
    const next = !starredIds.has(c.id);
    setStarredIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(c.id);
      else s.delete(c.id);
      return s;
    });
    void updateComposition({ id: c.id, courseId, starred: next }).then((res) => {
      if (!res.ok) {
        setStarredIds((prev) => {
          const s = new Set(prev);
          if (next) s.delete(c.id);
          else s.add(c.id);
          return s;
        });
        toast.error(res.error);
      }
    });
  }

  function restart() {
    clearTimer();
    speaker.cancel();
    pausedRef.current = false;
    revealedRef.current = false;
    setPaused(false);
    setReproducing(false);
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
              onClick={toggleStar}
              aria-pressed={current ? starredIds.has(current.id) : false}
              aria-label={
                current && starredIds.has(current.id)
                  ? 'この文の★を外す'
                  : 'この文に★をつける（言えなかった印）'
              }
              title="言えなかった文に★（次へは進みません）"
            >
              <Star
                className={cn(
                  'size-5',
                  current && starredIds.has(current.id)
                    ? 'fill-amber-500 text-amber-500'
                    : 'text-muted-foreground',
                )}
              />
            </Button>
          )}
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
          onClick={togglePause}
          className="relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-8 px-6 text-center"
          aria-label={paused ? '再開' : '一時停止'}
        >
          {/* 一時停止の合図は英文を覆わない（覆うと「止めて英文を見る」ができない）。
              上端の小さなピルだけで示し、本体はそのまま読ませる。 */}
          {paused && (
            <span className="pointer-events-none absolute top-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/90 px-4 py-2 text-sm font-medium shadow-sm">
              <Play className="size-4" />
              タップで再開
            </span>
          )}

          {/* 日本語（font-mono に入れない＝豆腐対策）。一時停止中は英文を主役にして一段落とす。 */}
          <p
            className={cn(
              'max-w-2xl leading-relaxed',
              paused && revealed
                ? 'text-xl text-muted-foreground sm:text-2xl'
                : 'text-2xl sm:text-3xl',
            )}
          >
            {current?.ja}
          </p>

          {/* 考える時間ゲージ / 答え */}
          <div className="flex min-h-[4rem] w-full max-w-2xl flex-col items-center gap-3">
            {revealed ? (
              <>
                {/* 止めているあいだは大きく。max-w-md だと折り返しが増えて読みにくい */}
                <p
                  className={cn(
                    'font-mono leading-relaxed text-foreground',
                    paused ? 'text-2xl sm:text-4xl' : 'text-xl sm:text-2xl',
                  )}
                >
                  {current?.en}
                </p>
                {/* 再現の間だけ細いゲージで残りを見せる（読み上げ中は出さない）。
                    key で文が変わるたびに頭から流し直す。一時停止は凍結。 */}
                {reproducing && (
                  <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                    <div
                      key={`rep-${index}`}
                      className="h-full origin-left rounded-full bg-foreground/50"
                      style={{
                        animation: `composition-drain ${REPRODUCE_PAUSE_MS}ms linear forwards`,
                        animationPlayState: paused ? 'paused' : 'running',
                      }}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {paused ? '一時停止中' : reproducing ? '声に出して再現' : '読み上げ中…'}
                </p>
              </>
            ) : (
              <>
                <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
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
                <p className="text-xs text-muted-foreground">
                  {paused ? '一時停止中' : '考える時間'}
                </p>
              </>
            )}
          </div>
        </button>
      )}

      {/* フッター */}
      {!finished && (
        <div className="flex flex-col gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            答えは自動で読み上げます・画面の真ん中をタップで一時停止
          </p>
          {/* 歩きながら片手で押せるよう、スマホでは全幅＋高さを取る */}
          <Button
            size="lg"
            onClick={advance}
            className="h-14 w-full rounded-full text-base sm:h-10 sm:w-auto sm:min-w-40 sm:rounded-lg sm:text-sm"
          >
            {revealed ? (
              <>
                次へ
                <ChevronRight className="size-5" />
              </>
            ) : (
              <>
                <Eye className="size-5" />
                答えを見る
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
