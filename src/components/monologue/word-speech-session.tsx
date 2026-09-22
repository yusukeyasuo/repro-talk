'use client';

import { Check, RotateCcw, Send, Shuffle, Sparkles, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useStudyGuard } from '@/components/study/study-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import * as speaker from '@/lib/speaker';
import {
  canSubmitSpeech,
  ratingMeta,
  summarizeWordUsage,
  type SpeechJudgeResult,
} from '@/lib/speech-judge';
import { cn } from '@/lib/utils';
import type { StudySession } from '@/types/database';

type Course = { id: string; title: string };
type SpeechWord = { ja: string; source_ja: string };
type Phase = 'setup' | 'writing' | 'judging' | 'result';

/** もう見せたワードの上限（出し直しで積み上がる）。サーバの MAX_AVOID と揃える。 */
const MAX_AVOID = 60;

type Props = {
  courses: Course[];
  /** 計測中の学習。机に向かう時間を計るかを訊くのに使う */
  running: StudySession | null;
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
 * 「ワードスピーチ」。瞬間英作文のコースから AI が日本語ワードをいくつか選び、
 * 学習者はそれを織り込んだ30〜60秒の英語スピーチを書く。AI が採点・添削する。
 * 瞬間英作文の添削（composition-judge-player）と同じ状態機械の考え方だが、
 * 録音・Wake Lock・音声は無く、机に向かう時間だけ useStudyGuard で任意計測する。
 */
export function WordSpeechSession({ courses, running }: Props) {
  const { guard, dialog: studyGuardDialog } = useStudyGuard('monologue', running);

  const [courseId, setCourseId] = useState(() => courses[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>('setup');
  const [words, setWords] = useState<SpeechWord[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [speech, setSpeech] = useState('');
  const [result, setResult] = useState<SpeechJudgeResult | null>(null);
  const [loadingWords, setLoadingWords] = useState(false);

  // in-flight のリクエスト。出し直し・採点・退出で abort する。
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // アンマウント時の後始末（読み上げの停止・通信の中断）。
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      speaker.cancel();
    };
  }, []);

  // 書くフェーズに入ったら入力欄へフォーカス。
  useEffect(() => {
    if (phase === 'writing') textareaRef.current?.focus();
  }, [phase, words]);

  async function fetchWords(nextAvoid: string[]) {
    if (!courseId) return;
    setLoadingWords(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/ai/speech-words', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseId, count: 3, avoid: nextAvoid }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) {
        toast.error(json.error ?? 'お題を作れませんでした');
        return;
      }
      const next = (json.words ?? []) as SpeechWord[];
      if (next.length === 0) {
        toast.error('お題を作れませんでした。もう一度試してください');
        return;
      }
      setWords(next);
      setAvoid((prev) => [...prev, ...next.map((w) => w.ja)].slice(-MAX_AVOID));
      setSpeech('');
      setResult(null);
      setPhase('writing');
    } catch {
      if (!controller.signal.aborted) toast.error('通信に失敗しました');
    } finally {
      if (!controller.signal.aborted) setLoadingWords(false);
    }
  }

  // 最初のお題づくり。計測を始めるか一度だけ訊いてから走らせる。
  function startWords() {
    guard(() => void fetchWords(avoid));
  }

  // 別のワードで（出し直し）。もう計測は判断済みなので guard は挟まない。
  function reshuffle() {
    void fetchWords(avoid);
  }

  function judge() {
    if (!canSubmitSpeech(speech)) return;
    setPhase('judging');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      try {
        const res = await fetch('/api/ai/monologue-speech-judge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ words: words.map((w) => w.ja), speech: speech.trim() }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          toast.error(json.error ?? '採点できませんでした');
          setPhase('writing'); // リトライ可能な状態へ戻す
          return;
        }
        setResult(json as SpeechJudgeResult);
        setPhase('result');
      } catch {
        if (!controller.signal.aborted) {
          toast.error('通信に失敗しました');
          setPhase('writing');
        }
      }
    })();
  }

  // 同じお題でもう一度書く（入力を空にして書くフェーズへ戻る）。
  function retrySameWords() {
    speaker.cancel();
    setSpeech('');
    setResult(null);
    setPhase('writing');
  }

  // 新しいお題（出し直し）。計測は判断済みなので guard は挟まない。
  function newWords() {
    speaker.cancel();
    void fetchWords(avoid);
  }

  const showCoursePicker = courses.length > 1;

  return (
    <div className="space-y-6">
      {studyGuardDialog}

      {/* お題づくり（コース選択） */}
      {phase === 'setup' && (
        <section className="space-y-4 rounded-xl border p-5">
          {showCoursePicker && (
            <div className="space-y-2">
              <p className="text-sm font-medium">どのコースからお題を作りますか</p>
              <Select value={courseId} onValueChange={(value) => setCourseId(value as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="コースを選ぶ">
                    {(value) => courses.find((course) => course.id === value)?.title ?? ''}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            そのコースの例文から、AI がいくつか日本語の言葉を選びます。英語の訳は出ません。自分で英語にしてスピーチに使ってみましょう。
          </p>
          <Button
            size="lg"
            className="h-14 w-full rounded-full text-base"
            onClick={startWords}
            disabled={loadingWords || !courseId}
          >
            {loadingWords ? <Spinner className="size-5" /> : <Sparkles className="size-5" />}
            {loadingWords ? '作成中…' : 'お題ワードをつくる'}
          </Button>
        </section>
      )}

      {/* スピーチを書く */}
      {(phase === 'writing' || phase === 'judging') && (
        <section className="space-y-5">
          <div className="space-y-3 rounded-xl border p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">この言葉を使ってスピーチする</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={reshuffle}
                disabled={loadingWords || phase === 'judging'}
                className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground"
              >
                {loadingWords ? <Spinner className="size-3.5" /> : <Shuffle className="size-3.5" />}
                他のワードで
              </Button>
            </div>
            {/* お題は日本語。font-mono に入れない（豆腐対策）。 */}
            <ul className="space-y-2">
              {words.map((word) => (
                <li key={`${word.ja}-${word.source_ja}`} className="rounded-lg border p-3">
                  <p className="text-lg font-medium">{word.ja}</p>
                  {word.source_ja && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{word.source_ja}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <Textarea
              ref={textareaRef}
              value={speech}
              onChange={(e) => setSpeech(e.target.value)}
              disabled={phase === 'judging'}
              lang="en"
              rows={7}
              maxLength={4000}
              placeholder="ここに英語のスピーチを書きます"
              className="text-base"
            />
            <p className="text-xs text-muted-foreground">
              30〜60秒くらいで話す内容を書いてみましょう。完璧でなくて大丈夫です。
            </p>
            {phase === 'judging' && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                AI が読んでいます。10〜30秒ほどかかります。
              </p>
            )}
          </div>

          <Button
            size="lg"
            className="h-14 w-full rounded-full text-base"
            onClick={judge}
            disabled={phase === 'judging' || !canSubmitSpeech(speech)}
          >
            {phase === 'judging' ? <Spinner className="size-5" /> : <Send className="size-5" />}
            {phase === 'judging' ? '採点中…' : '採点してもらう'}
          </Button>
        </section>
      )}

      {/* 結果 */}
      {phase === 'result' && result && (
        <section className="space-y-5">
          {/* 判定＋総評 */}
          <div className="space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <Badge className={ratingMeta(result.rating).badgeClass}>
                {ratingMeta(result.rating).label}
              </Badge>
              {result.word_usage.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  お題{' '}
                  <span className="font-mono tabular-nums">
                    {summarizeWordUsage(result.word_usage).used}
                  </span>{' '}
                  /{' '}
                  <span className="font-mono tabular-nums">
                    {summarizeWordUsage(result.word_usage).total}
                  </span>
                </p>
              )}
            </div>
            <p className="text-sm leading-relaxed">{result.feedback_ja}</p>
          </div>

          {/* お題ワードの使用状況 */}
          {result.word_usage.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium text-muted-foreground">お題ワード</h2>
              <ul className="space-y-2">
                {result.word_usage.map((usage, i) => (
                  <li
                    key={`${usage.word}-${i}`}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3',
                      usage.used ? 'border-foreground/30 bg-accent/40' : 'border-dashed',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                        usage.used
                          ? 'border-foreground bg-foreground text-background'
                          : 'text-muted-foreground',
                      )}
                    >
                      {usage.used ? <Check className="size-3" /> : <X className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{usage.word}</span>
                      {usage.comment_ja && (
                        <span className="block text-xs text-muted-foreground">
                          {usage.comment_ja}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 添削（スピーチの書き直し） */}
          <section className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">自然にすると</h2>
            <div className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <p className="min-w-0 flex-1 font-mono text-sm leading-relaxed">{result.corrected}</p>
              <SpeakButton text={result.corrected} label="添削したスピーチを読み上げ" />
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

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={retrySameWords}>
              <RotateCcw className="size-4" />
              もう一度
            </Button>
            <Button onClick={newWords} disabled={loadingWords}>
              {loadingWords ? <Spinner className="size-4" /> : <Shuffle className="size-4" />}
              新しいお題
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
