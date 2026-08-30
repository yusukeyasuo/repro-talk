'use client';

import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type GrammarResult = {
  headline: string;
  build: string;
  points: { focus: string; label: string; detail: string }[];
  pitfalls: { wrong: string; why: string }[];
  variations: { en: string; ja: string }[];
};

/**
 * 同じ例文への解説を、タブが生きているあいだだけ使い回す。DB には保存しない。
 * ドリルは同じ文を何周も回すので、2周目で20〜30秒の待ちを繰り返さないための措置。
 * キーは日本語＋英語なので、例文を直せば自然に取り直しになる（speaker.ts の音声URLと同じ考え方）。
 */
const cache = new Map<string, GrammarResult>();
const cacheKey = (ja: string, en: string) => `${ja}\n---\n${en}`;

type Props = {
  ja: string;
  en: string;
  onClose: () => void;
};

/**
 * 瞬間英作文のドリル中に「なぜこの英語になるのか」を止まって確かめるための面。
 * プレイヤー全体に被せるので、開いているあいだは読み上げもタイマーも止まっている。
 */
export function GrammarPanel({ ja, en, onClose }: Props) {
  const key = cacheKey(ja, en);
  const [result, setResult] = useState<GrammarResult | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  // 取り直しの世代。「もう一度」で増やして effect を回し直す。
  const [attempt, setAttempt] = useState(0);

  // 状態のリセットはここでやる（effect の中で同期的に setState しない）。
  function retry() {
    cache.delete(key);
    setResult(null);
    setError(null);
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    // 取得済みのものは useState の初期値で入っている。取り直しでは retry が消してある。
    if (cache.has(key)) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch('/api/ai/grammar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ja, en }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(json.error ?? '解説を取得できませんでした');
          return;
        }
        cache.set(key, json as GrammarResult);
        setResult(json as GrammarResult);
      } catch {
        // 閉じたときの中断はエラーではない
        if (!controller.signal.aborted) setError('通信に失敗しました');
      }
    })();

    return () => controller.abort();
  }, [key, ja, en, attempt]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      {/* ヘッダー：何の文の解説かを常に見えるところに置く */}
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">文法解説</p>
          <p className="mt-1 truncate text-sm">{ja}</p>
          <p className="truncate font-mono text-sm text-muted-foreground">{en}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="解説を閉じる"
          className="shrink-0"
        >
          <X className="size-5" />
        </Button>
      </div>

      {/* 本文 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!result && !error && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Spinner className="size-6" />
            <p className="text-sm text-muted-foreground">
              AI が解説を書いています。10〜30秒ほどかかります。
            </p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={retry}>
              <RotateCcw className="size-4" />
              もう一度
            </Button>
          </div>
        )}

        {result && (
          <div className="mx-auto max-w-2xl space-y-6 text-sm">
            <section className="space-y-2">
              <p className="text-base font-medium">{result.headline}</p>
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {result.build}
              </p>
            </section>

            {result.points.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">迷いどころ</h2>
                <ul className="space-y-2">
                  {result.points.map((p, i) => (
                    <li key={`${p.focus}-${i}`} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-sm">{p.focus}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {p.label}
                        </span>
                      </div>
                      <p className="mt-1.5 leading-relaxed text-muted-foreground">{p.detail}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.pitfalls.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">やりがちな誤り</h2>
                <ul className="space-y-2">
                  {result.pitfalls.map((p, i) => (
                    <li key={`${p.wrong}-${i}`} className="rounded-lg bg-muted/50 p-3">
                      <p className="font-mono text-sm line-through decoration-muted-foreground/60">
                        {p.wrong}
                      </p>
                      <p className="mt-1.5 leading-relaxed text-muted-foreground">{p.why}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.variations.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-muted-foreground">同じ型で言ってみる</h2>
                <ul className="space-y-2">
                  {result.variations.map((v, i) => (
                    <li key={`${v.en}-${i}`} className="rounded-lg border p-3">
                      <p className="font-mono text-sm">{v.en}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{v.ja}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {/* フッター：閉じてもドリルは止まったまま。再開は本人のタップに任せる */}
      <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          size="lg"
          variant="outline"
          onClick={onClose}
          className="h-14 w-full rounded-full text-base sm:h-10 sm:rounded-lg sm:text-sm"
        >
          閉じてドリルに戻る
        </Button>
      </div>
    </div>
  );
}
