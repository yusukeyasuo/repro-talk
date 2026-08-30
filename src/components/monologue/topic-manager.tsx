'use client';

import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  addCustomTopic,
  deleteCustomTopic,
  importCustomTopics,
  updateCustomTopic,
} from '@/app/actions/monologue';
import { SuggestTopicsDialog } from '@/components/monologue/suggest-topics-dialog';
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
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { parseMonologueTopicsCsv } from '@/lib/monologue-topic-csv';
import type { MonologueTopic } from '@/types/database';

export function TopicManager({
  own,
  seeds,
}: {
  own: MonologueTopic[];
  seeds: MonologueTopic[];
}) {
  return (
    <div className="space-y-8">
      <AddTopicForm />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            自分のお題 <span className="font-mono tabular-nums">{own.length}</span> 件
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <SuggestTopicsDialog />
            <ImportTopicsDialog />
          </div>
        </div>

        {own.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            まだありません。上のフォーム・AIの提案・貼り付けでの一括登録のどれかから足すと、独り言のお題に混ざります。
          </p>
        ) : (
          <ul className="space-y-2">
            {own.map((topic) => (
              <OwnTopicRow key={topic.id} topic={topic} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          最初から入っているお題 <span className="font-mono tabular-nums">{seeds.length}</span> 件
        </h2>
        <p className="text-xs text-muted-foreground">
          全員に共通のお題なので、ここからは直せません。文言を変えたいときは、自分のお題として書き直してください。
        </p>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
          {seeds.map((topic) => (
            <li key={topic.id} className="p-3">
              <p className="font-mono text-sm">{topic.title_en}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{topic.title_ja}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AddTopicForm() {
  const router = useRouter();
  const [titleEn, setTitleEn] = useState('');
  const [titleJa, setTitleJa] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await addCustomTopic({ titleEn, titleJa });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTitleEn('');
      setTitleJa('');
      toast.success('お題を追加しました');
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="add-topic-en">英語</Label>
          <Input
            id="add-topic-en"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            placeholder="What I want to build next"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-topic-ja">日本語</Label>
          <Input
            id="add-topic-ja"
            value={titleJa}
            onChange={(e) => setTitleJa(e.target.value)}
            placeholder="次に作りたいもの"
          />
        </div>
      </div>
      <Button onClick={submit} disabled={pending || !titleEn.trim() || !titleJa.trim()}>
        {pending ? <Spinner /> : <Plus className="size-4" />}
        {pending ? '追加中…' : 'お題を追加'}
      </Button>
    </div>
  );
}

function ImportTopicsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();

  const parsed = parseMonologueTopicsCsv(text);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then(setText);
  }

  function submit() {
    if (parsed.rows.length === 0) {
      toast.error('登録できる行がありません');
      return;
    }
    startTransition(async () => {
      const res = await importCustomTopics({ rows: parsed.rows });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.data.added} 件を登録しました`);
      setText('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Upload className="size-4" />
            貼り付けで一括登録
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>貼り付けで一括登録</DialogTitle>
          <DialogDescription>
            1行 = 「英語,日本語」。英作文の一括登録とは並びが逆（英語が先）なので気をつけてください。スプレッドシートからのタブ区切り貼り付けもそのまま使えます。お題にカンマが入る場合は
            {' "..." '}
            で囲ってください。見出し行があれば自動で除きます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'What I did today,今日やったこと\nMy hometown,地元の話'}
            // field-sizing-content で内容ぶん伸びるので、上限を切って内部スクロールにする
            // （伸びきってフッターのボタンが画面外に出るのを防ぐ）
            className="max-h-64 resize-none overflow-y-auto font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="cursor-pointer text-xs text-muted-foreground underline">
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                className="hidden"
                onChange={onFile}
              />
              ファイルを選ぶ
            </label>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">{parsed.rows.length}</span> 件を登録
              {parsed.skipped > 0 && (
                <>
                  {' / '}
                  <span className="font-mono tabular-nums">{parsed.skipped}</span> 行スキップ
                </>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || parsed.rows.length === 0}>
            {pending && <Spinner />}
            {pending ? '登録中…' : '登録する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnTopicRow({ topic }: { topic: MonologueTopic }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deleteCustomTopic(topic.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('削除しました');
      router.refresh();
    });
  }

  return (
    <li className="flex items-start gap-2 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm">{topic.title_en}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{topic.title_ja}</p>
      </div>
      <EditTopicDialog topic={topic} />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={remove}
        disabled={pending}
        aria-label="このお題を削除"
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function EditTopicDialog({ topic }: { topic: MonologueTopic }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [titleEn, setTitleEn] = useState(topic.title_en);
  const [titleJa, setTitleJa] = useState(topic.title_ja);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await updateCustomTopic({ id: topic.id, titleEn, titleJa });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('更新しました');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // 開くたびに今の値に戻す（前回キャンセルした編集内容を持ち越さない）
        if (o) {
          setTitleEn(topic.title_en);
          setTitleJa(topic.title_ja);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="このお題を編集"
            className="shrink-0 text-muted-foreground"
          >
            <Pencil />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>お題を編集</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`edit-topic-en-${topic.id}`}>英語</Label>
            <Input
              id={`edit-topic-en-${topic.id}`}
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-topic-ja-${topic.id}`}>日本語</Label>
            <Input
              id={`edit-topic-ja-${topic.id}`}
              value={titleJa}
              onChange={(e) => setTitleJa(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !titleEn.trim() || !titleJa.trim()}>
            {pending && <Spinner />}
            {pending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
