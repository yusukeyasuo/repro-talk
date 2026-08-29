'use client';

import { Check, Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { addPhrases } from '@/app/actions/phrases';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type Candidate = { text: string; meaning_ja: string; why: string };

type Props = {
  clipId: string;
  transcript: string;
};

/**
 * リプロダクションで「100のまま」入れた表現を、独り言（0から1）で使う在庫に移す。
 * この受け渡しが動画で言う「0と100が一気に繋がる」ところ。
 */
export function PhrasePanel({ clipId, transcript }: Props) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function extract() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/phrases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'フレーズを抽出できませんでした');
        return;
      }
      setCandidates(json.phrases as Candidate[]);
    } catch {
      toast.error('通信に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  function save(candidate: Candidate) {
    startTransition(async () => {
      const result = await addPhrases({
        clipId,
        phrases: [{ text: candidate.text, meaning_ja: candidate.meaning_ja }],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved((prev) => new Set(prev).add(candidate.text));
      toast.success('フレーズ・ストックに追加しました');
    });
  }

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={extract} disabled={loading || !transcript}>
        {loading ? <Spinner className="size-3.5" /> : <Sparkles className="size-4" />}
        {loading ? '抽出中…' : '独り言で使えるフレーズを抽出'}
      </Button>

      {candidates && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground">使い回せそうな表現が見つかりませんでした。</p>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="space-y-2">
          {candidates.map((candidate) => {
            const isSaved = saved.has(candidate.text);
            return (
              <li key={candidate.text} className="rounded-lg border p-3">
                <p className="font-mono text-sm">{candidate.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{candidate.meaning_ja}</p>
                <p className="mt-1 text-xs text-muted-foreground">{candidate.why}</p>
                <Button
                  size="sm"
                  variant={isSaved ? 'ghost' : 'outline'}
                  className="mt-2"
                  onClick={() => save(candidate)}
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
    </div>
  );
}
