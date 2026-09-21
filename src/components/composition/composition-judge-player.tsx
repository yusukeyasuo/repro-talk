'use client';

import { Check, ChevronLeft, ChevronRight, RotateCcw, Send, Star, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { logCompositionReps, updateComposition } from '@/app/actions/compositions';
import { type PlayProgress } from '@/components/composition/composition-player';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { canSubmitAttempt, type JudgeResult, ratingMeta } from '@/lib/composition-judge';
import * as speaker from '@/lib/speaker';
import { cn } from '@/lib/utils';
import type { Composition } from '@/types/database';

type Phase = 'input' | 'judging' | 'result';

type Props = {
  courseId: string;
  courseTitle: string;
  /** すでに順番解決済みの再生列（登録順 or シャッフル済み） */
  sequence: Composition[];
  /** 続きから開始する位置（0 で最初から） */
  startIndex: number;
  /** ×／完了で抜けるとき、次に再開すべき位置を渡す */
  onExit: (progress: PlayProgress) => void;
  /**
   * ドリル中に再開位置が動くたび（次へ・スキップ・戻る・採点完了）と、
   * 画面を裏に回した／閉じたときに呼ぶ。歩きながら使うので明示終了を待たず、
   * 毎回 localStorage へ書いておくことで「続きから」が実際に効く。
   */
  onProgress?: (progress: PlayProgress) => void;
};

/** 読み上げボタン。クリックの中で解錠してから読み上げる（iOS 対策）。 */
function SpeakButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        speaker.unlock();
        speaker.speak(text);
      }}
      aria-label={label}
      className="shrink-0"
    >
      <Volume2 className="size-4" />
    </Button>
  );
}

/**
 * 瞬間英作文の「AI添削モード」。日本語を見て自分で英文を打ち、AI が自然さを
 * Great/Good/Bad で判定して添削と別の言い方を返す。暗記プレイヤー（composition-player）
 * とは状態機械が別物（考える時間のタイマー・自動送りが無く、入力して待つユーザー主導）なので
 * 兄弟コンポーネントとして分けている。
 */
export function CompositionJudgePlayer({
  courseId,
  courseTitle,
  sequence,
  startIndex,
  onExit,
  onProgress,
}: Props) {
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock();

  const total = sequence.length;

  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, total - 1)),
  );
  const [phase, setPhase] = useState<Phase>('input');
  const [finished, setFinished] = useState(false);
  const [attempt, setAttempt] = useState('');
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [doneThisRound, setDoneThisRound] = useState(0);
  // ★（重点マーク）の楽観状態。退出時の router.refresh（CourseScreen 側）でサーバ値へ寄せ直る。
  const [starredIds, setStarredIds] = useState<Set<string>>(
    () => new Set(sequence.filter((c) => c.starred).map((c) => c.id)),
  );

  // 現在の文について採点を送ったか（退出時の再開位置の計算に使う。composition-player の revealed 相当）。
  const submittedRef = useRef(false);
  // 二重送信防止（採点中に「採点する」を連打しても1回だけ投げる）。
  const submittingRef = useRef(false);
  // in-flight の採点。次へ／前へ／退出／unmount で abort する。
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const current = sequence[index];

  // 起動時：解錠（gesture 直後にもう一度）＋ Wake Lock
  useEffect(() => {
    speaker.unlock();
    void requestWakeLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アンマウント時の後始末
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      speaker.cancel();
      void releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 入力フェーズに入ったら入力欄へフォーカス（歩きながらでもすぐ打てるように）。
  useEffect(() => {
    if (phase === 'input' && !finished) textareaRef.current?.focus();
  }, [phase, finished, index]);

  // 再開位置が動くたびに保存する（次へ・スキップ・戻る・採点完了）。exitNow と同じ式で
  // 位置を出すので、明示終了で抜けたときと続きが一致する（採点済み＝次へ、未採点＝現在位置）。
  useEffect(() => {
    const next = finished ? total : submittedRef.current ? index + 1 : index;
    onProgress?.({ index: next, finished });
    // phase は「採点完了で done になった」瞬間を拾うための依存（式では submittedRef を見る）。
  }, [index, phase, finished, total, onProgress]);

  // 画面を裏に回した／閉じたときにも保存する。歩きながらのアプリでは終了ボタンを押さず
  // ロックして終わることが多いので、ここが実際の「退出」になる。
  useEffect(() => {
    const flush = () => {
      const next = finished ? total : submittedRef.current ? index + 1 : index;
      onProgress?.({ index: next, finished });
    };
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [index, finished, total, onProgress]);

  function submit() {
    if (submittingRef.current) return;
    if (!current || !canSubmitAttempt(attempt)) return;
    submittingRef.current = true;

    // 送信＝練習1回（暗記の reveal と同じ）。1文につき1回だけ数える。失敗しても残す。
    if (!submittedRef.current) {
      submittedRef.current = true;
      setDoneThisRound((n) => n + 1);
      void logCompositionReps({ courseId, repCount: 1 });
    }

    setPhase('judging');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const res = await fetch('/api/ai/composition-judge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ja: current.ja, en: current.en, attempt: attempt.trim() }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          toast.error(json.error ?? '採点できませんでした');
          setPhase('input'); // リトライ可能な状態へ戻す
          return;
        }
        setResult(json as JudgeResult);
        setPhase('result');
      } catch {
        // 次へ／退出での中断はエラーではない
        if (!controller.signal.aborted) {
          toast.error('通信に失敗しました');
          setPhase('input');
        }
      } finally {
        if (!controller.signal.aborted) submittingRef.current = false;
      }
    })();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter でも送れる（PC で手を離さずに）。
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  // 次の文へ（in-flight を止め、入力状態をリセット）。
  function goNext() {
    abortRef.current?.abort();
    abortRef.current = null;
    submittedRef.current = false;
    submittingRef.current = false;
    setAttempt('');
    setResult(null);
    setPhase('input');
    if (index + 1 >= total) {
      setFinished(true);
      void releaseWakeLock();
    } else {
      setIndex(index + 1);
    }
  }

  // 1つ前の文へ戻る。もう一度自分で書き直せるよう入力状態はまっさらにする。
  function goPrev() {
    if (index === 0) return;
    abortRef.current?.abort();
    abortRef.current = null;
    submittedRef.current = false;
    submittingRef.current = false;
    setAttempt('');
    setResult(null);
    setPhase('input');
    setIndex(index - 1);
  }

  // ★のトグル。楽観更新し、失敗したら戻す（composition-player と同じ）。
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
    abortRef.current?.abort();
    abortRef.current = null;
    submittedRef.current = false;
    submittingRef.current = false;
    setAttempt('');
    setResult(null);
    setDoneThisRound(0);
    setFinished(false);
    setPhase('input');
    setIndex(0);
    void requestWakeLock();
  }

  function exitNow() {
    abortRef.current?.abort();
    speaker.cancel();
    // 次に再開すべき位置：採点を送った文は完了とみなして次へ、まだなら現在位置。
    const next = finished ? total : submittedRef.current ? index + 1 : index;
    onExit({ index: next, finished });
  }

  const starred = current ? starredIds.has(current.id) : false;
  const overall =
    total === 0 ? 0 : Math.round(((index + (phase === 'result' ? 1 : 0)) / total) * 100);

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
              採点 <span className="font-mono tabular-nums">{doneThisRound}</span>
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!finished && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleStar}
              aria-pressed={starred}
              aria-label={starred ? 'この文の★を外す' : 'この文に★をつける（要練習の印）'}
              title="要練習の文に★"
            >
              <Star
                className={cn('size-5', starred ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground')}
              />
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
            <p className="text-lg font-medium">腕試しおつかれさまでした</p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono tabular-nums">{doneThisRound}</span> 文を採点しました。
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={restart}>
              <RotateCcw className="size-4" />
              もう一周
            </Button>
            <Button onClick={exitNow}>一覧に戻る</Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {/* お題の日本語（font-mono に入れない＝豆腐対策）。参考解答はこの段階では隠す。 */}
            <p className="text-2xl leading-relaxed sm:text-3xl">{current?.ja}</p>

            {phase === 'result' && result ? (
              <div className="space-y-5">
                {/* 判定＋総評 */}
                <div className="space-y-2 rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge className={ratingMeta(result.rating).badgeClass}>
                      {ratingMeta(result.rating).label}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={toggleStar}
                      aria-pressed={starred}
                      aria-label={starred ? 'この文の★を外す' : 'この文に★をつける（要練習の印）'}
                      title="要練習の文に★"
                    >
                      <Star
                        className={cn(
                          'size-5',
                          starred ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground',
                        )}
                      />
                    </Button>
                  </div>
                  <p className="leading-relaxed text-sm">{result.feedback_ja}</p>
                  {/* 自分が書いた英文（振り返り用）。英語のみ font-mono。 */}
                  <p className="border-t pt-2 font-mono text-sm text-muted-foreground">{attempt.trim()}</p>
                </div>

                {/* 添削 */}
                <section className="space-y-2">
                  <h2 className="text-xs font-medium text-muted-foreground">添削</h2>
                  <div className="flex items-start justify-between gap-2 rounded-lg border p-3">
                    <p className="min-w-0 flex-1 font-mono text-sm leading-relaxed">{result.corrected}</p>
                    <SpeakButton text={result.corrected} label="添削文を読み上げ" />
                  </div>
                </section>

                {/* 別の言い方 */}
                {result.alternatives.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-xs font-medium text-muted-foreground">別の言い方</h2>
                    <ul className="space-y-2">
                      {result.alternatives.map((alt, i) => (
                        <li
                          key={`${alt.en}-${i}`}
                          className="flex items-start justify-between gap-2 rounded-lg border p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-sm leading-relaxed">{alt.en}</p>
                            {alt.note_ja && (
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {alt.note_ja}
                              </p>
                            )}
                          </div>
                          <SpeakButton text={alt.en} label="この言い方を読み上げ" />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* 参考解答（自分の答えを出したあとに開示） */}
                {current?.en && (
                  <section className="space-y-2">
                    <h2 className="text-xs font-medium text-muted-foreground">参考解答</h2>
                    <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 p-3">
                      <p className="min-w-0 flex-1 font-mono text-sm leading-relaxed">{current.en}</p>
                      <SpeakButton text={current.en} label="参考解答を読み上げ" />
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Textarea
                  ref={textareaRef}
                  value={attempt}
                  onChange={(e) => setAttempt(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={phase === 'judging'}
                  autoFocus
                  lang="en"
                  rows={3}
                  maxLength={1000}
                  placeholder="ここに英語を入力"
                  className="text-base"
                />
                {phase === 'judging' && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    AI が採点しています。10〜30秒ほどかかります。
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* フッター */}
      {!finished && (
        <div className="flex flex-col gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex flex-col items-center gap-0.5 sm:items-start">
            <p className="text-center text-xs text-muted-foreground sm:text-left">
              {phase === 'result'
                ? '自然さは自分の英文で見ています・参考解答と違ってもかまいません'
                : '日本語を見て自分で英作文し、AI に自然さを見てもらいます'}
            </p>
            {/* 思いつかない文は採点せずに送れる。主役の「採点する」と競わないよう控えめに。
                採点しない＝1回にも数えない（goNext は submittedRef を立てない）。 */}
            {phase === 'input' && (
              <Button
                variant="link"
                size="sm"
                onClick={goNext}
                className="h-auto p-0 text-xs font-normal text-muted-foreground"
              >
                スキップ（採点せずに次へ）
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goPrev}
              disabled={index === 0 || phase === 'judging'}
              aria-label="1つ前の文に戻る"
              title="1つ前の文に戻る"
              className="size-14 shrink-0 rounded-full sm:size-10 sm:rounded-lg"
            >
              <ChevronLeft className="size-5" />
            </Button>
            {phase === 'result' ? (
              <Button
                size="lg"
                onClick={goNext}
                className="h-14 flex-1 rounded-full text-base sm:h-10 sm:min-w-40 sm:flex-none sm:rounded-lg sm:text-sm"
              >
                次へ
                <ChevronRight className="size-5" />
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={submit}
                disabled={phase === 'judging' || !canSubmitAttempt(attempt)}
                className="h-14 flex-1 rounded-full text-base sm:h-10 sm:min-w-40 sm:flex-none sm:rounded-lg sm:text-sm"
              >
                {phase === 'judging' ? <Spinner /> : <Send className="size-5" />}
                {phase === 'judging' ? '採点中…' : '採点する'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
