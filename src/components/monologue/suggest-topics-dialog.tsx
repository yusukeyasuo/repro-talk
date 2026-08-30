'use client';

import { RotateCcw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { importCustomTopics } from '@/app/actions/monologue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { TopicSuggestion } from '@/lib/topic-suggestions';

/** サーバ側の COUNTS と揃える。 */
const COUNTS = [10, 20, 30];
const DEFAULT_COUNT = 10;

/**
 * 「仕事で使いそうなテーマ」のような方向性を渡して、お題の候補を出してもらう面。
 * 出てきたものを全部入れる導線にはしない。自分の生活に寄せたお題ほど言葉が出るので、
 * 採否は1件ずつ本人が決める（既定は全選択で、外すのが手間にならない程度に留める）。
 */
export function SuggestTopicsDialog() {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<TopicSuggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // 生成中に閉じられたら捨てる（戻ってきた結果で閉じた面を書き換えない）
  const abortRef = useRef<AbortController | null>(null);
  // このダイアログを開いてから見せた候補。出し直しで同じものを引かないために積む。
  const shownRef = useRef<string[]>([]);

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    shownRef.current = [];
    setDirection('');
    setCount(DEFAULT_COUNT);
    setLoading(false);
    setTopics([]);
    setSelected(new Set());
  }

  function suggest() {
    const trimmed = direction.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch('/api/ai/topic-ideas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ direction: trimmed, count, avoid: shownRef.current }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;

        if (!res.ok) {
          toast.error(json.error ?? '候補を取得できませんでした');
          return;
        }

        const next = (json.topics ?? []) as TopicSuggestion[];
        if (next.length === 0) {
          toast.error('新しい候補が出ませんでした。方向性を変えて試してください');
          return;
        }

        shownRef.current = [...shownRef.current, ...next.map((topic) => topic.titleEn)];
        setTopics(next);
        setSelected(new Set(next.map((topic) => topic.titleEn)));
      } catch {
        // 閉じたときの中断はエラーではない
        if (!controller.signal.aborted) toast.error('通信に失敗しました');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
  }

  function toggle(titleEn: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(titleEn);
      else next.delete(titleEn);
      return next;
    });
  }

  function register() {
    const rows = topics
      .filter((topic) => selected.has(topic.titleEn))
      .map((topic) => ({ titleEn: topic.titleEn, titleJa: topic.titleJa }));
    if (rows.length === 0) return;

    startTransition(async () => {
      const res = await importCustomTopics({ rows });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.data.added} 件を登録しました`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 閉じたら前回の候補は持ち越さない（次に開いたときに古い提案が並んでいると紛らわしい）
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Sparkles className="size-4" />
            AIに提案してもらう
          </Button>
        }
      />
      {/* 候補が並ぶと縦に伸びるので、本文だけを送って「登録する」を常に画面内に置く */}
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AIにお題を提案してもらう</DialogTitle>
          <DialogDescription>
            どんな方向のお題が欲しいかを書くと、候補が並びます。話せそうなものだけ選んで登録してください。すでにあるお題と同じものは除いてあります。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-direction`}>どんな方向のお題が欲しいか</Label>
            <Textarea
              id={`${uid}-direction`}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder={'例）仕事で使いそうなテーマ / 週末の過ごし方 / 子どもとの生活'}
              className="resize-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm">候補の数</span>
            <ToggleGroup
              value={[String(count)]}
              onValueChange={(value) => {
                const next = Number(value[0]);
                // 選択済みをもう一度押すと空になるので、そのときは今の件数を保つ
                if (COUNTS.includes(next)) setCount(next);
              }}
              variant="outline"
              size="sm"
            >
              {COUNTS.map((n) => (
                <ToggleGroupItem key={n} value={String(n)} aria-label={`${n}件`}>
                  <span className="font-mono tabular-nums">{n}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {topics.length === 0 && (
              <Button
                onClick={suggest}
                disabled={loading || !direction.trim()}
                className="ms-auto"
              >
                {loading ? <Spinner /> : <Sparkles className="size-4" />}
                {loading ? '考えています…' : '提案してもらう'}
              </Button>
            )}
          </div>

          {loading && topics.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Spinner className="size-6" />
              <p className="text-sm text-muted-foreground">
                AI が候補を考えています。20〜60秒ほどかかります。
              </p>
            </div>
          )}

          {topics.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{topics.length}</span> 件中
                  <span className="ms-1 font-mono tabular-nums">{selected.size}</span> 件を選択中
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    onClick={() =>
                      setSelected(
                        selected.size === topics.length
                          ? new Set()
                          : new Set(topics.map((topic) => topic.titleEn)),
                      )
                    }
                  >
                    {selected.size === topics.length ? '全解除' : '全選択'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={suggest} disabled={loading}>
                    {loading ? <Spinner /> : <RotateCcw className="size-4" />}
                    出し直す
                  </Button>
                </div>
              </div>

              <ul className="space-y-2">
                {topics.map((topic, index) => {
                  const id = `${uid}-topic-${index}`;
                  return (
                    <li key={topic.titleEn} className="flex items-start gap-3 rounded-lg border p-3">
                      <Checkbox
                        id={id}
                        checked={selected.has(topic.titleEn)}
                        onCheckedChange={(checked) => toggle(topic.titleEn, checked === true)}
                        className="mt-1"
                      />
                      <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-normal leading-normal">
                        <span className="block min-w-0">
                          <span className="block font-mono text-sm">{topic.titleEn}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {topic.titleJa}
                          </span>
                          {topic.whyJa && (
                            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground/80">
                              {topic.whyJa}
                            </span>
                          )}
                        </span>
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={register} disabled={pending || loading || selected.size === 0}>
            {pending && <Spinner />}
            {pending ? '登録中…' : `${selected.size} 件を登録`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
