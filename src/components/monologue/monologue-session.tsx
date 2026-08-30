'use client';

import { Check, ListOrdered, Mic, Pencil, Shuffle, Sparkles, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveMonologueFeedback, saveMonologueSession } from '@/app/actions/monologue';
import { addPhrases, markPhraseUsed } from '@/app/actions/phrases';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useStudyGuard } from '@/components/study/study-guard';
import { Textarea } from '@/components/ui/textarea';
import { useRecorder } from '@/hooks/use-recorder';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { cn } from '@/lib/utils';
import { formatDurationJa } from '@/lib/youtube';
import type { AiSuggestion, MonologueTopic, Phrase, StudySession } from '@/types/database';

type Props = {
  topics: MonologueTopic[];
  phrases: Phrase[];
  goalSec: number;
  /** 計測中の学習。1人電話を始めるときに「計測せずに始めるか」を訊くのに使う */
  running: StudySession | null;
};

/** 日付ベースで今日のお題を決める（1日1個で1ヶ月まわる）。 */
function todayIndex(length: number) {
  if (length === 0) return 0;
  const now = new Date();
  const days = Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
  );
  return days % length;
}

export function MonologueSession({ topics, phrases, goalSec, running }: Props) {
  const router = useRouter();
  const recorder = useRecorder();
  const wakeLock = useWakeLock();
  const { guard, dialog: studyGuardDialog } = useStudyGuard('monologue', running);

  const [topicIndex, setTopicIndex] = useState(() => todayIndex(topics.length));
  const [usedPhraseIds, setUsedPhraseIds] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastDuration, setLastDuration] = useState(0);
  const [saving, setSaving] = useState(false);

  const [jaMemo, setJaMemo] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null);
  const [askingAi, setAskingAi] = useState(false);
  const [savedSuggestions, setSavedSuggestions] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const topic = topics[topicIndex] ?? null;
  const progress = Math.min(100, Math.round((recorder.elapsedSec / goalSec) * 100));

  async function start() {
    setSessionId(null);
    setSuggestions(null);
    setJaMemo('');
    await wakeLock.request();
    await recorder.start();
  }

  async function stop() {
    const result = await recorder.stop();
    await wakeLock.release();
    if (!result) return;

    setLastDuration(result.durationSec);
    setSaving(true);
    try {
      // 録音は「やった事実」の可視化が目的で、音声そのものは聴き返さない。
      // だから Storage には上げず、話した時間だけを記録する。
      const session = await saveMonologueSession({
        topicId: topic?.id ?? null,
        mode: 'phone',
        durationSec: result.durationSec,
        usedPhraseIds: [...usedPhraseIds],
      });
      if (!session.ok) {
        toast.error(session.error);
        return;
      }
      setSessionId(session.data.id);
      URL.revokeObjectURL(result.url);
      toast.success(`${formatDurationJa(result.durationSec)} 話しました`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function togglePhrase(phrase: Phrase) {
    const next = new Set(usedPhraseIds);
    if (next.has(phrase.id)) {
      next.delete(phrase.id);
      setUsedPhraseIds(next);
      return;
    }
    next.add(phrase.id);
    setUsedPhraseIds(next);
    startTransition(async () => {
      const result = await markPhraseUsed(phrase.id);
      if (!result.ok) toast.error(result.error);
    });
  }

  async function askAi() {
    if (!jaMemo.trim()) return;
    setAskingAi(true);
    try {
      const res = await fetch('/api/ai/monologue-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ja_memo: jaMemo, topic: topic?.title_en }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '英語表現を取得できませんでした');
        return;
      }
      const next = json.suggestions as AiSuggestion[];
      setSuggestions(next);
      if (sessionId) {
        await saveMonologueFeedback({ sessionId, jaMemo, suggestions: next });
      }
    } catch {
      toast.error('通信に失敗しました');
    } finally {
      setAskingAi(false);
    }
  }

  function stockSuggestion(suggestion: AiSuggestion) {
    startTransition(async () => {
      const result = await addPhrases({
        phrases: [{ text: suggestion.text, meaning_ja: suggestion.meaning_ja }],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSavedSuggestions((prev) => new Set(prev).add(suggestion.text));
      toast.success('フレーズ・ストックに追加しました');
    });
  }

  return (
    <div className="space-y-6">
      {studyGuardDialog}

      {/* お題 */}
      <section className="rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">今日のお題</p>
            <p className="mt-1 text-lg font-medium">{topic?.title_en ?? '—'}</p>
            <p className="text-sm text-muted-foreground">{topic?.title_ja ?? ''}</p>
          </div>
          <div className="flex shrink-0 items-center">
            {/* 自分のお題は並びの末尾に付くので、送りだけだと届かない。一覧から直接選べるようにする。 */}
            <TopicPicker
              topics={topics}
              currentIndex={topicIndex}
              onSelect={setTopicIndex}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setTopicIndex((i) => (i + 1) % Math.max(1, topics.length))}
              aria-label="別のお題"
            >
              <Shuffle className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* 録音（1人電話） */}
      <section className="rounded-xl border p-6 text-center">
        <div className="mx-auto flex max-w-xs flex-col items-center gap-4">
          <div className="font-mono text-5xl tabular-nums">
            {String(Math.floor(recorder.elapsedSec / 60)).padStart(2, '0')}:
            {String(recorder.elapsedSec % 60).padStart(2, '0')}
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            目標 {formatDurationJa(goalSec)}。まずは1分から。
          </p>

          <Button
            size="lg"
            variant={recorder.isRecording ? 'destructive' : 'default'}
            className="h-16 w-full rounded-full text-base"
            onClick={recorder.isRecording ? stop : () => guard(() => void start())}
            disabled={recorder.state === 'requesting' || saving}
          >
            {saving ? (
              <Spinner className="size-5" />
            ) : recorder.isRecording ? (
              <Square className="size-5" />
            ) : (
              <Mic className="size-5" />
            )}
            {saving ? '保存中…' : recorder.isRecording ? '終わる' : '1人電話を始める'}
          </Button>

          {recorder.error && <p className="text-xs text-destructive">{recorder.error}</p>}

          {recorder.isRecording && !wakeLock.active && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {wakeLock.supported
                ? '画面が消えると録音が止まります。'
                : 'このブラウザは画面ロック防止に対応していません。画面を消さないでください。'}
            </p>
          )}

          {!recorder.isRecording && lastDuration > 0 && (
            <p className="text-xs text-muted-foreground">
              前回 {formatDurationJa(lastDuration)}
            </p>
          )}
        </div>

        <p className="mx-auto mt-5 max-w-sm text-xs text-muted-foreground">
          歩きながら電話しているフリで話し続けます。相手に伝えるという設定があるだけで、英語を作り出す速度が上がります。
        </p>
      </section>

      {/* 今日使うフレーズ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">今日使うフレーズ</h2>
          <Badge variant="secondary">使えたらタップ</Badge>
          {/* 在庫の全部と「身についた」はここから。下のナビには置いていない。 */}
          <Link
            href="/phrases"
            className="-mr-2 ml-auto flex min-h-10 touch-manipulation items-center px-2 text-xs text-muted-foreground hover:underline"
          >
            すべて見る
          </Link>
        </div>

        {phrases.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            まだストックがありません。リプロダクションでフレーズを抽出すると、ここに出てきます。
          </p>
        ) : (
          <ul className="space-y-2">
            {phrases.map((phrase) => {
              const used = usedPhraseIds.has(phrase.id);
              return (
                <li key={phrase.id}>
                  <button
                    type="button"
                    onClick={() => togglePhrase(phrase)}
                    disabled={pending}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      used ? 'border-foreground bg-accent' : 'hover:bg-accent/40',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                        used && 'border-foreground bg-foreground text-background',
                      )}
                    >
                      {used && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">{phrase.text}</span>
                      {phrase.meaning_ja && (
                        <span className="block text-xs text-muted-foreground">
                          {phrase.meaning_ja}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 言えなかったことを英語にする */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">言えなかったことを英語にする</h2>
        <Textarea
          value={jaMemo}
          onChange={(e) => setJaMemo(e.target.value)}
          rows={4}
          placeholder={'「電車が遅れてイライラした」って言いたかったけど出てこなかった'}
        />
        <Button onClick={askAi} disabled={askingAi || !jaMemo.trim()}>
          {askingAi ? <Spinner /> : <Sparkles className="size-4" />}
          {askingAi ? '考え中…' : '英語にしてもらう'}
        </Button>

        {suggestions && (
          <ul className="space-y-2">
            {suggestions.map((suggestion) => {
              const isSaved = savedSuggestions.has(suggestion.text);
              return (
                <li key={suggestion.text} className="rounded-lg border p-3">
                  <p className="font-mono text-sm">{suggestion.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {suggestion.meaning_ja}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {suggestion.examples.map((example) => (
                      <li key={example} className="rounded bg-muted/50 p-2 font-mono text-xs">
                        {example}
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    variant={isSaved ? 'ghost' : 'outline'}
                    className="mt-2"
                    onClick={() => stockSuggestion(suggestion)}
                    disabled={isSaved || pending}
                  >
                    {isSaved ? (
                      <>
                        <Check className="size-4" />
                        追加済み
                      </>
                    ) : (
                      'ストックに追加'
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** お題の一覧から選ぶ。自分で足したお題を先に出す（そのために足しているので）。 */
function TopicPicker({
  topics,
  currentIndex,
  onSelect,
}: {
  topics: MonologueTopic[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // 選択は配列の添字で持っているので、絞り込んでも元の位置を連れて回る。
  const indexed = topics.map((topic, index) => ({ topic, index }));
  const own = indexed.filter(({ topic }) => topic.user_id !== null);
  const seeds = indexed.filter(({ topic }) => topic.user_id === null);

  function choose(index: number) {
    onSelect(index);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="icon" variant="ghost" aria-label="お題を選ぶ">
            <ListOrdered className="size-4" />
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>お題を選ぶ</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {own.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">自分のお題</h3>
              <ul className="space-y-1">
                {own.map(({ topic, index }) => (
                  <TopicPickerRow
                    key={topic.id}
                    topic={topic}
                    selected={index === currentIndex}
                    onSelect={() => choose(index)}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              最初から入っているお題
            </h3>
            <ul className="space-y-1">
              {seeds.map(({ topic, index }) => (
                <TopicPickerRow
                  key={topic.id}
                  topic={topic}
                  selected={index === currentIndex}
                  onSelect={() => choose(index)}
                />
              ))}
            </ul>
          </section>

          <Link
            href="/monologue/topics"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
          >
            <Pencil className="size-3.5" />
            お題を追加・編集する
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TopicPickerRow({
  topic,
  selected,
  onSelect,
}: {
  topic: MonologueTopic;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          'w-full rounded-lg border p-3 text-left transition-colors',
          selected ? 'border-foreground bg-accent' : 'hover:bg-accent/40',
        )}
      >
        <span className="block font-mono text-sm">{topic.title_en}</span>
        <span className="block text-xs text-muted-foreground">{topic.title_ja}</span>
      </button>
    </li>
  );
}
