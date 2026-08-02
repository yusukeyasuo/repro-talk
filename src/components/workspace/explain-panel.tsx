'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ExplainResult = {
  headline: string;
  explanation: string;
  examples: { en: string; ja: string; when: string }[];
};

type Props = {
  transcript: string;
  onAppendMemo: (markdown: string) => void;
};

/**
 * 動画で ChatGPT にやらせていた「この yet ってどういうこと?」をアプリ内で完結させる。
 * 単語帳で覚えるより、文脈で出会った疑問を解いたほうが定着する、という前提。
 */
export function ExplainPanel({ transcript, onAppendMemo }: Props) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!question.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const selection =
        typeof window !== 'undefined' ? window.getSelection()?.toString() ?? '' : '';
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript, selection, question }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '解説を取得できませんでした');
        return;
      }
      setResult(json as ExplainResult);
    } catch {
      toast.error('通信に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  function saveToMemo() {
    if (!result) return;
    const markdown = [
      `### ${question}`,
      '',
      `**${result.headline}**`,
      '',
      result.explanation,
      '',
      ...result.examples.map((e) => `- ${e.en}\n  - ${e.ja}（${e.when}）`),
    ].join('\n');
    onAppendMemo(markdown);
    toast.success('メモに保存しました');
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) ask();
          }}
          placeholder="ここの yet はどういう意味？"
        />
        <Button onClick={ask} disabled={loading || !question.trim()}>
          <Sparkles className="size-4" />
          {loading ? '…' : '聞く'}
        </Button>
      </div>

      {result && (
        <div className="space-y-3 rounded-lg border p-4 text-sm">
          <p className="font-medium">{result.headline}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{result.explanation}</p>
          <ul className="space-y-2">
            {result.examples.map((example) => (
              <li key={example.en} className="rounded-md bg-muted/50 p-2">
                <p className="font-mono text-sm">{example.en}</p>
                <p className="text-xs text-muted-foreground">
                  {example.ja} — {example.when}
                </p>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" onClick={saveToMemo}>
            メモに残す
          </Button>
        </div>
      )}
    </div>
  );
}
