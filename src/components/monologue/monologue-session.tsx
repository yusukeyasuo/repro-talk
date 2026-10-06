'use client';

import {
  ArrowRight,
  Check,
  ChevronDown,
  ListOrdered,
  Mic,
  PenLine,
  Pencil,
  Sparkles,
  Square,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
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
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { WritingPanel } from '@/components/monologue/writing-panel';
import { useStudyGuard } from '@/components/study/study-guard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useRecorder } from '@/hooks/use-recorder';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { todayJst } from '@/lib/activity';
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

/** 選んだお題（その日だけ有効）と、最後に使ったモード。端末ごとの便利機能なので DB には持たない。 */
const TOPIC_KEY = 'monologue:topic';
const MODE_KEY = 'monologue:mode';

type Mode = 'speak' | 'write';

/** 今日選んだお題の id。日付が変わっていたら日替わりのお題に戻すので null。 */
function readPickedTopicId(): string | null {
  try {
    const raw = localStorage.getItem(TOPIC_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { date?: unknown; topicId?: unknown };
    return saved.date === todayJst() && typeof saved.topicId === 'string' ? saved.topicId : null;
  } catch {
    return null;
  }
}

function writePickedTopicId(topicId: string) {
  try {
    localStorage.setItem(TOPIC_KEY, JSON.stringify({ date: todayJst(), topicId }));
  } catch {
    // 保存できなくても選択そのものは効いている
  }
}

export function MonologueSession({ topics, phrases, goalSec, running }: Props) {
  const router = useRouter();
  const recorder = useRecorder();
  const wakeLock = useWakeLock();
  const { guard, dialog: studyGuardDialog } = useStudyGuard('monologue', running);

  const [topicIndex, setTopicIndex] = useState(() => todayIndex(topics.length));
  // 自分で選んだ（送った）お題か。ラベルを「今日のお題」と「選んだお題」で出し分ける
  const [picked, setPicked] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('speak');
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

  // localStorage は外部ストア。SSR と初期HTMLは既定値で描き、マウント後に一度だけ同期する。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const pickedId = readPickedTopicId();
    const index = pickedId ? topics.findIndex((t) => t.id === pickedId) : -1;
    if (index >= 0) {
      setTopicIndex(index);
      setPicked(true);
    }
    try {
      if (localStorage.getItem(MODE_KEY) === 'write') setMode('write');
    } catch {
      // 読めなければ既定の「話す」のまま
    }
    // マウント時に一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function selectTopic(index: number) {
    const next = topics[index];
    if (!next) return;
    setTopicIndex(index);
    setPicked(true);
    writePickedTopicId(next.id);
  }

  function changeMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // 保存できなくても切り替えそのものは効いている
    }
  }
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

      {/* お題。カードそのものを押すと一覧が開く（自分のお題は並びの末尾にあり、送りだけだと届かない） */}
      <section className="rounded-xl border">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={topics.length === 0}
          className="flex w-full items-start justify-between gap-3 rounded-t-xl p-5 text-left transition-colors hover:bg-accent/40"
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              {picked ? '選んだお題' : '今日のお題'}
            </span>
            <span className="mt-1 block text-lg font-medium">{topic?.title_en ?? '—'}</span>
            <span className="block text-sm text-muted-foreground">{topic?.title_ja ?? ''}</span>
          </span>
          <ChevronDown className="mt-6 size-5 shrink-0 text-muted-foreground" />
        </button>
        <div className="grid grid-cols-2 border-t">
          <Button
            variant="ghost"
            className="h-12 rounded-none rounded-bl-xl"
            onClick={() => setPickerOpen(true)}
            disabled={topics.length === 0}
          >
            <ListOrdered className="size-4" />
            一覧から選ぶ
          </Button>
          <Button
            variant="ghost"
            className="h-12 rounded-none rounded-br-xl border-l"
            onClick={() => selectTopic((topicIndex + 1) % Math.max(1, topics.length))}
            disabled={topics.length === 0}
          >
            次のお題
            <ArrowRight className="size-4" />
          </Button>
        </div>
        <TopicPicker
          topics={topics}
          currentIndex={topicIndex}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={selectTopic}
        />
      </section>

      {/* 話す（1人電話）と書く（添削）。独り言の本筋は声を出すほうなので既定は「話す」 */}
      <Tabs value={mode} onValueChange={(value) => changeMode(value as Mode)}>
        <TabsList className="h-11 w-full group-data-horizontal/tabs:h-11">
          <TabsTrigger value="speak" className="text-base">
            <Mic className="size-4" />
            話す
          </TabsTrigger>
          <TabsTrigger value="write" className="text-base">
            <PenLine className="size-4" />
            書く
          </TabsTrigger>
        </TabsList>

        <TabsContent value="speak">
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

        </TabsContent>

        <TabsContent value="write">
          {/* 声を出していないので、話した時間には記録しない */}
          <WritingPanel topic={topic} guard={guard} />
        </TabsContent>
      </Tabs>

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
  open,
  onOpenChange,
  onSelect,
}: {
  topics: MonologueTopic[];
  currentIndex: number;
  /** カードとボタンのどちらからでも開けるように、開閉は親が持つ */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}) {

  // 選択は配列の添字で持っているので、絞り込んでも元の位置を連れて回る。
  const indexed = topics.map((topic, index) => ({ topic, index }));
  const own = indexed.filter(({ topic }) => topic.user_id !== null);
  const seeds = indexed.filter(({ topic }) => topic.user_id === null);

  function choose(index: number) {
    onSelect(index);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
