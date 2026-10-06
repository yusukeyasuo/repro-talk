'use client';

import { ArrowRight, Check, PenLine, Plus, Send, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { addPhrases } from '@/app/actions/phrases';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import * as speaker from '@/lib/speaker';
import { canSubmitSpeech, ratingMeta, type WritingJudgeResult } from '@/lib/writing-judge';
import type { MonologueTopic } from '@/types/database';

type Phase = 'writing' | 'judging' | 'result';

type Props = {
  topic: MonologueTopic | null;
  /**
   * 計測し忘れの確認（useStudyGuard）。1人電話と同じ画面なので親の1つを共有する
   * （別々に持つと、話す・書くを行き来するたびに訊き直してしまう）。
   */
  guard: (action: () => void) => void;
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
 * 独り言の「書く」モード。お題について英語を書き、AI に添削してもらう。
 * 声を出していないので、独り言の「話した時間」（monologue_sessions）には記録しない。
 * 添削結果も保存しない（ワードスピーチと同じ扱い）。残したい言い回しはフレーズ・ストックへ。
 */
export function WritingPanel({ topic, guard }: Props) {
  const [phase, setPhase] = useState<Phase>('writing');
  const [text, setText] = useState('');
  const [result, setResult] = useState<WritingJudgeResult | null>(null);
  const [savedPhrases, setSavedPhrases] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // in-flight のリクエスト。書き直し・退出で abort する。
  const abortRef = useRef<AbortController | null>(null);

  // アンマウント時の後始末（読み上げの停止・通信の中断）。
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      speaker.cancel();
    };
  }, []);

  function judge() {
    if (!canSubmitSpeech(text)) return;
    setPhase('judging');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void (async () => {
      try {
        const res = await fetch('/api/ai/monologue-writing-judge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topic: topic ? { en: topic.title_en, ja: topic.title_ja } : null,
            text: text.trim(),
          }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          toast.error(json.error ?? '添削できませんでした');
          setPhase('writing'); // リトライ可能な状態へ戻す
          return;
        }
        setResult(json as WritingJudgeResult);
        setSavedPhrases(new Set());
        setPhase('result');
      } catch {
        if (!controller.signal.aborted) {
          toast.error('通信に失敗しました');
          setPhase('writing');
        }
      }
    })();
  }

  // 本文を残したまま書く画面へ戻る（添削を見ながら自分で直す）。
  function rewrite() {
    speaker.cancel();
    setResult(null);
    setPhase('writing');
  }

  // 空の入力欄から書き始める。
  function startOver() {
    speaker.cancel();
    setText('');
    setResult(null);
    setPhase('writing');
  }

  function stockPhrase(alt: WritingJudgeResult['alternatives'][number]) {
    startTransition(async () => {
      const res = await addPhrases({ phrases: [{ text: alt.en, meaning_ja: alt.meaning_ja }] });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSavedPhrases((prev) => new Set(prev).add(alt.en));
      toast.success('フレーズ・ストックに追加しました');
    });
  }

  return (
    <div className="space-y-5">
      {(phase === 'writing' || phase === 'judging') && (
        <section className="space-y-3">
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={phase === 'judging'}
              lang="en"
              rows={7}
              maxLength={4000}
              placeholder="お題について、話すつもりで英語を書きます"
              aria-label="お題について英語で書く"
              className="text-base"
            />
            <p className="text-xs text-muted-foreground">
              完璧でなくて大丈夫です。英語が出てこないところは日本語のままで書いておけば、英語にして返します。
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
            onClick={() => guard(judge)}
            disabled={phase === 'judging' || !canSubmitSpeech(text)}
          >
            {phase === 'judging' ? <Spinner className="size-5" /> : <Send className="size-5" />}
            {phase === 'judging' ? '添削中…' : '添削してもらう'}
          </Button>
        </section>
      )}

      {phase === 'result' && result && (
        <section className="space-y-5">
          {/* 判定＋総評 */}
          <div className="space-y-2 rounded-xl border p-4">
            <Badge className={ratingMeta(result.rating).badgeClass}>
              {ratingMeta(result.rating).label}
            </Badge>
            <p className="text-sm leading-relaxed">{result.feedback_ja}</p>
          </div>

          {/* 直したところ。before は日本語のこともあるので font-mono に入れない */}
          {result.corrections.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium text-muted-foreground">直したところ</h2>
              <ul className="space-y-2">
                {result.corrections.map((c, i) => (
                  <li key={`${c.before}-${i}`} className="rounded-lg border p-3">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground line-through">{c.before}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{c.after}</span>
                    </p>
                    {c.note_ja && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {c.note_ja}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 全文の書き直し */}
          <section className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">自然にすると</h2>
            <div className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <p className="min-w-0 flex-1 font-mono text-sm leading-relaxed">{result.corrected}</p>
              <SpeakButton text={result.corrected} label="添削した文章を読み上げ" />
            </div>
            <p className="text-xs text-muted-foreground">
              読み上げを聞いたら、声に出して言ってみましょう。
            </p>
          </section>

          {/* 別の言い方 */}
          {result.alternatives.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-medium text-muted-foreground">別の言い方</h2>
              <ul className="space-y-2">
                {result.alternatives.map((alt, i) => {
                  const saved = savedPhrases.has(alt.en);
                  return (
                    <li key={`${alt.en}-${i}`} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm leading-relaxed">{alt.en}</p>
                          {alt.meaning_ja && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{alt.meaning_ja}</p>
                          )}
                          {alt.note_ja && (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {alt.note_ja}
                            </p>
                          )}
                        </div>
                        <SpeakButton text={alt.en} label="この言い方を読み上げ" />
                      </div>
                      <Button
                        size="sm"
                        variant={saved ? 'ghost' : 'outline'}
                        className="mt-2"
                        onClick={() => stockPhrase(alt)}
                        disabled={saved || pending}
                      >
                        {saved ? <Check className="size-4" /> : <Plus className="size-4" />}
                        {saved ? '追加済み' : 'ストックに追加'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" size="lg" className="h-12" onClick={rewrite}>
              <PenLine className="size-4" />
              書き直す
            </Button>
            <Button size="lg" className="h-12" onClick={startOver}>
              新しく書く
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
