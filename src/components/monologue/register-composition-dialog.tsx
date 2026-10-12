'use client';

import { Check, Zap } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { addToMonologueCourse } from '@/app/actions/compositions';
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
import type { WritingJudgeResult } from '@/lib/writing-judge';

type Candidate = { key: string; ja: string; en: string };

type Props = {
  result: WritingJudgeResult;
  /** コース名に入れるお題（日本語）。お題なしなら null */
  topicJa: string | null;
};

/**
 * 添削の「自然にすると」（文ごと）と「別の言い方」から、反復したい文を選んで
 * 瞬間英作文のコースへ入れる。行き先は日付＋お題ごとのコース（「独り言 M/D お題」）で、
 * 同じ日・同じお題で書き直したものも同じコースにまとまる（決め方は addToMonologueCourse）。
 * 同じ添削から2回目以降に登録したものは、1回目に入れたコースへ足す。
 * この部品は結果画面でだけ描かれ、書き直すとアンマウントされるので、courseId と
 * 登録済みの行は添削結果ごとに自然にリセットされる。
 *
 * 入れた英語はドリルで「正解」として読み上げられるので、AI の出力を無検品で入れない。
 * 初期状態は未選択で、1件ずつ本人が選ぶ（全選択はあるが、押すのは本人）。
 */
export function RegisterCompositionDialog({ result, topicJa }: Props) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // この添削から登録済みの行。同じ結果を開き直しても選べないようにする
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  // この添削で入れたコース。2回目以降の登録はここへ足す
  const [course, setCourse] = useState<{ id: string; title: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const sentences: Candidate[] = result.corrected_sentences.map((s, i) => ({
    key: `s-${i}`,
    ja: s.ja,
    en: s.en,
  }));
  const alternatives: Candidate[] = result.alternatives
    .filter((a) => a.meaning_ja.trim() !== '')
    .map((a, i) => ({ key: `a-${i}`, ja: a.meaning_ja, en: a.en }));
  const selectable = [...sentences, ...alternatives].filter((c) => !registered.has(c.key));

  function toggle(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function register() {
    const picked = selectable.filter((c) => selected.has(c.key));
    if (picked.length === 0) return;

    startTransition(async () => {
      const res = await addToMonologueCourse({
        courseId: course?.id ?? null,
        topicJa,
        rows: picked.map((c) => ({ ja: c.ja, en: c.en })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRegistered((prev) => new Set([...prev, ...picked.map((c) => c.key)]));
      setSelected(new Set());
      setOpen(false);

      const { courseId, courseTitle, added, skipped } = res.data;
      setCourse({ id: courseId, title: courseTitle });
      toast.success(
        added > 0 ? `「${courseTitle}」に ${added} 件追加しました` : 'すべて登録済みの文でした',
        {
          description: skipped > 0 && added > 0 ? `${skipped} 件は登録済みだったので飛ばしました` : undefined,
          action: (
            <Link href={`/compositions/${courseId}`} className="text-xs font-medium underline">
              コースを開く
            </Link>
          ),
        },
      );
    });
  }

  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.key));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="lg" className="h-12 w-full">
            <Zap className="size-4" />
            瞬間英作文に登録
          </Button>
        }
      />
      {/* 候補が並ぶと縦に伸びるので、本文だけを送って「登録する」を常に画面内に置く */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>瞬間英作文に登録</DialogTitle>
          <DialogDescription>
            {course
              ? `選んだ文は、この添削のコース「${course.title}」に足されます。`
              : '反復して覚えたい文を選ぶと、今日の日付とお題のコースに入ります（同じ日に同じお題で書いたものは1つのコースにまとまります）。日本語を見て英語を言うドリルになります。'}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-4">
          {selectable.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.key)))
                }
              >
                {allSelected ? '全解除' : '全選択'}
              </Button>
            </div>
          )}

          <CandidateGroup
            title="自然にすると"
            candidates={sentences}
            uid={uid}
            selected={selected}
            registered={registered}
            onToggle={toggle}
          />
          <CandidateGroup
            title="別の言い方"
            candidates={alternatives}
            uid={uid}
            selected={selected}
            registered={registered}
            onToggle={toggle}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            閉じる
          </Button>
          <Button onClick={register} disabled={pending || selected.size === 0}>
            {pending && <Spinner />}
            {pending ? '登録中…' : `登録する（${selected.size}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateGroup({
  title,
  candidates,
  uid,
  selected,
  registered,
  onToggle,
}: {
  title: string;
  candidates: Candidate[];
  uid: string;
  selected: Set<string>;
  registered: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {candidates.map((c) => {
          const id = `${uid}-${c.key}`;
          const done = registered.has(c.key);
          return (
            <li key={c.key} className="flex items-start gap-3 rounded-lg border p-3">
              {done ? (
                <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-sm bg-foreground text-background">
                  <Check className="size-3" />
                </span>
              ) : (
                <Checkbox
                  id={id}
                  checked={selected.has(c.key)}
                  onCheckedChange={(checked) => onToggle(c.key, checked === true)}
                  className="mt-1"
                />
              )}
              <Label
                htmlFor={done ? undefined : id}
                className="min-w-0 flex-1 cursor-pointer font-normal leading-normal"
              >
                <span className="block min-w-0">
                  {/* 問題文（日本語）は font-mono に入れない（豆腐対策） */}
                  <span className="block text-sm">{c.ja}</span>
                  <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                    {c.en}
                  </span>
                  {done && <span className="mt-1 block text-xs text-muted-foreground">登録済み</span>}
                </span>
              </Label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
