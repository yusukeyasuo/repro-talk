'use client';

import { RotateCcw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { importCompositions } from '@/app/actions/compositions';
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

/** サーバ側の COUNTS と揃える。 */
const COUNTS = [5, 10, 20];
const DEFAULT_COUNT = 10;

type Idea = {
  ja: string;
  en: string;
  whyJa: string;
  /** 元にした例文（型が本当に残っているかを見て採否を決めるため） */
  sources: { ja: string; en: string }[];
};

/**
 * 応用練習の仕込み面。コース内の例文を2〜3文ずつ組み合わせ、主語や目的語を変えた
 * 日本語＋その答えの英語を AI に作らせる。
 *
 * **出てきたものをそのままコースへ入れる導線にはしない。** 答えの英語はドリル中に
 * 「正解」として読み上げられるので、無検品の AI 出力を混ぜると誤った英語を覚える。
 * 採否は1件ずつ本人が決める（お題の AI 提案と同じ考え方）。
 */
export function AppliedPracticeDialog({
  courseId,
  /** 材料に使える例文（source='manual'）の件数。2件未満だと組み合わせようがない */
  seedCount,
  /** 登録できたときに親へ知らせる（プレイヤーの対象を「応用のみ」へ寄せる） */
  onRegistered,
}: {
  courseId: string;
  seedCount: number;
  onRegistered?: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [situation, setSituation] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // 生成中に閉じられたら捨てる（戻ってきた結果で閉じた面を書き換えない）
  const abortRef = useRef<AbortController | null>(null);
  // この面を開いてから見せた候補の日本語。出し直しで同じものを引かないために積む。
  const shownRef = useRef<string[]>([]);

  const enoughSeeds = seedCount >= 2;

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    shownRef.current = [];
    setSituation('');
    setCount(DEFAULT_COUNT);
    setLoading(false);
    setIdeas([]);
    setSelected(new Set());
  }

  function generate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch('/api/ai/composition-ideas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId,
            count,
            situation: situation.trim(),
            avoid: shownRef.current,
          }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;

        if (!res.ok) {
          toast.error(json.error ?? '応用問題を作れませんでした');
          return;
        }

        const next = (json.ideas ?? []) as Idea[];
        if (next.length === 0) {
          toast.error('新しい応用問題が出ませんでした。場面を変えて試してください');
          return;
        }

        shownRef.current = [...shownRef.current, ...next.map((idea) => idea.ja)];
        setIdeas(next);
        setSelected(new Set(next.map((idea) => idea.ja)));
      } catch {
        // 閉じたときの中断はエラーではない
        if (!controller.signal.aborted) toast.error('通信に失敗しました');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
  }

  function toggle(ja: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(ja);
      else next.delete(ja);
      return next;
    });
  }

  function register() {
    const rows = ideas
      .filter((idea) => selected.has(idea.ja))
      .map((idea) => ({ ja: idea.ja, en: idea.en }));
    if (rows.length === 0) return;

    startTransition(async () => {
      const res = await importCompositions({ courseId, rows, source: 'ai' });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`応用を ${res.data.added} 件追加しました`);
      setOpen(false);
      reset();
      onRegistered?.();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 閉じたら前回の候補は持ち越さない（次に開いたときに古い候補が並んでいると紛らわしい）
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={!enoughSeeds}>
            <Sparkles className="size-4" />
            応用を作る
          </Button>
        }
      />
      {/* 候補が並ぶと縦に伸びるので、本文だけを送って「追加する」を常に画面内に置く */}
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AIに応用問題を作ってもらう</DialogTitle>
          <DialogDescription>
            コースの例文を2〜3文ずつ組み合わせ、主語や目的語を変えた日本語と、その答えの英語を作ります。
            <strong className="font-medium text-foreground">
              答えの英語はドリル中にそのまま読み上げられます。
            </strong>
            納得できるものだけ選んで追加してください（追加後に一覧から直せます）。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-situation`}>使いたい場面（任意）</Label>
            <Textarea
              id={`${uid}-situation`}
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder={'例）海外チームとの進捗共有 / 見積もりの交渉 / 採用の1次面接'}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              空のままなら、職種を選ばない一般的な仕事の場面で作ります。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm">問題の数</span>
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
                <ToggleGroupItem key={n} value={String(n)} aria-label={`${n}問`}>
                  <span className="font-mono tabular-nums">{n}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {ideas.length === 0 && (
              <Button onClick={generate} disabled={loading} className="ms-auto">
                {loading ? <Spinner /> : <Sparkles className="size-4" />}
                {loading ? '作っています…' : '作ってもらう'}
              </Button>
            )}
          </div>

          {loading && ideas.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Spinner className="size-6" />
              <p className="text-sm text-muted-foreground">
                AI が応用問題を作っています。30秒〜2分ほどかかります。
              </p>
            </div>
          )}

          {ideas.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">{ideas.length}</span> 件中
                  <span className="ms-1 font-mono tabular-nums">{selected.size}</span> 件を選択中
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    onClick={() =>
                      setSelected(
                        selected.size === ideas.length
                          ? new Set()
                          : new Set(ideas.map((idea) => idea.ja)),
                      )
                    }
                  >
                    {selected.size === ideas.length ? '全解除' : '全選択'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={generate} disabled={loading}>
                    {loading ? <Spinner /> : <RotateCcw className="size-4" />}
                    出し直す
                  </Button>
                </div>
              </div>

              <ul className="space-y-2">
                {ideas.map((idea, index) => {
                  const id = `${uid}-idea-${index}`;
                  return (
                    <li key={idea.ja} className="flex items-start gap-3 rounded-lg border p-3">
                      <Checkbox
                        id={id}
                        checked={selected.has(idea.ja)}
                        onCheckedChange={(checked) => toggle(idea.ja, checked === true)}
                        className="mt-1"
                      />
                      <Label
                        htmlFor={id}
                        className="min-w-0 flex-1 cursor-pointer font-normal leading-normal"
                      >
                        <span className="block min-w-0">
                          <span className="block text-sm">{idea.ja}</span>
                          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                            {idea.en}
                          </span>
                          {idea.whyJa && (
                            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground/80">
                              {idea.whyJa}
                            </span>
                          )}
                          {idea.sources.length > 0 && (
                            <span className="mt-2 block border-t pt-2">
                              <span className="block text-xs text-muted-foreground/80">
                                元にした例文
                              </span>
                              {idea.sources.map((source, i) => (
                                <span
                                  key={`${source.en}-${i}`}
                                  className="mt-1 block font-mono text-xs text-muted-foreground/70"
                                >
                                  {source.en}
                                </span>
                              ))}
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={register} disabled={pending || selected.size === 0}>
            {pending && <Spinner />}
            {pending ? '追加中…' : `コースに追加（${selected.size}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
