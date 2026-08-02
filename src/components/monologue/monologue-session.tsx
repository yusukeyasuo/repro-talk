'use client';

import { Check, Loader2, Mic, Shuffle, Sparkles, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveMonologueFeedback, saveMonologueSession } from '@/app/actions/monologue';
import { addPhrases, markPhraseUsed } from '@/app/actions/phrases';
import { saveRecording } from '@/app/actions/recordings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { extensionForMimeType, useRecorder } from '@/hooks/use-recorder';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { formatDurationJa } from '@/lib/youtube';
import type { AiSuggestion, MonologueTopic, Phrase } from '@/types/database';

type Props = {
  topics: MonologueTopic[];
  phrases: Phrase[];
  userId: string;
  goalSec: number;
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

export function MonologueSession({ topics, phrases, userId, goalSec }: Props) {
  const router = useRouter();
  const recorder = useRecorder();
  const wakeLock = useWakeLock();

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

      // 録音は「やった事実」を残すのが目的。失敗しても記録自体は残す。
      const supabase = createClient();
      const path = `${userId}/monologue/${crypto.randomUUID()}.${extensionForMimeType(
        result.mimeType,
      )}`;
      const { error } = await supabase.storage
        .from('recordings')
        .upload(path, result.blob, { contentType: result.mimeType });

      if (error) {
        toast.warning('録音の保存に失敗しましたが、記録は残しました');
      } else {
        await saveRecording({
          kind: 'monologue',
          storagePath: path,
          mimeType: result.mimeType,
          durationSec: result.durationSec,
          monologueSessionId: session.data.id,
        });
      }

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
      {/* お題 */}
      <section className="rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">今日のお題</p>
            <p className="mt-1 text-lg font-medium">{topic?.title_en ?? '—'}</p>
            <p className="text-sm text-muted-foreground">{topic?.title_ja ?? ''}</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setTopicIndex((i) => (i + 1) % Math.max(1, topics.length))}
            aria-label="別のお題"
          >
            <Shuffle className="size-4" />
          </Button>
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
            onClick={recorder.isRecording ? stop : start}
            disabled={recorder.state === 'requesting' || saving}
          >
            {saving ? (
              <Loader2 className="size-5 animate-spin" />
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
          <Sparkles className="size-4" />
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
