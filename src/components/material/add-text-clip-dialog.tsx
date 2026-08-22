'use client';

import { FileText, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createTextClip } from '@/app/actions/clips';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Suggestion = { naturalized: string; note_ja: string };

export function AddTextClipDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  // AI推敲を採用したときの元文。未推敲なら null のまま。
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [naturalizing, setNaturalizing] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTitle('');
    setText('');
    setSourceText(null);
    setSuggestion(null);
  }

  async function naturalize() {
    const body = text.trim();
    if (!body) return;
    setNaturalizing(true);
    setSuggestion(null);
    try {
      const res = await fetch('/api/ai/naturalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '推敲に失敗しました');
        return;
      }
      setSuggestion({ naturalized: json.naturalized ?? '', note_ja: json.note_ja ?? '' });
    } catch {
      toast.error('通信に失敗しました');
    } finally {
      setNaturalizing(false);
    }
  }

  function adopt() {
    if (!suggestion) return;
    setSourceText(text); // いまの本文を元文として残す
    setText(suggestion.naturalized);
    setSuggestion(null);
    toast.success('推敲後の英文を採用しました');
  }

  function submit() {
    startTransition(async () => {
      const result = await createTextClip({
        label: title,
        transcript: text,
        sourceText,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('テキストを登録しました');
      setOpen(false);
      reset();
      router.push(`/clips/${result.data.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <FileText className="size-4" />
            テキストを登録
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>自作テキストを登録</DialogTitle>
          <DialogDescription>
            ニュース・本の一節や、自分で書いた英文を登録します。クラウド音声で読み上げ、YouTube
            と同じように1文ずつ止めて再現します。
          </DialogDescription>
        </DialogHeader>

        {/* 本文や推敲プレビューが長くてもフッター（登録ボタン）を押せるよう、
            本体だけをスクロールさせる */}
        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="text-clip-title">タイトル（任意）</Label>
            <Input
              id="text-clip-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 好きな映画のセリフ"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="text-clip-body">本文（英語）</Label>
            <Textarea
              id="text-clip-body"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSuggestion(null);
              }}
              rows={6}
              placeholder="ここに英語のテキストを貼るか、打ち込みます。"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={naturalize}
                disabled={naturalizing || !text.trim()}
              >
                <Sparkles className="size-4" />
                {naturalizing ? '推敲中…' : 'AIで自然にする'}
              </Button>
              <span className="text-xs text-muted-foreground">
                自分で書いた英文を「完成された英語」に整えます。記事・本の一節など元が自然な文には不要。
              </span>
            </div>
          </div>

          {suggestion && (
            <div className="space-y-3 rounded-lg border bg-accent/30 p-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">推敲後</p>
                <p className="max-h-56 overflow-y-auto text-sm leading-relaxed">
                  {suggestion.naturalized}
                </p>
              </div>
              {suggestion.note_ja && (
                <p className="text-xs text-muted-foreground">{suggestion.note_ja}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={adopt}>
                  この英文を採用
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSuggestion(null)}
                >
                  使わない
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !text.trim()}>
            {pending ? '登録中…' : '登録して練習へ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
