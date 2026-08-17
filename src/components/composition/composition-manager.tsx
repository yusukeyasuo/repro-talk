'use client';

import { Pencil, Plus, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  addComposition,
  deleteComposition,
  importCompositions,
  updateComposition,
} from '@/app/actions/compositions';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTts } from '@/hooks/use-tts';
import { parseCompositionsCsv } from '@/lib/composition-csv';
import { cn } from '@/lib/utils';
import type { Composition } from '@/types/database';

export function CompositionManager({
  courseId,
  compositions,
}: {
  courseId: string;
  compositions: Composition[];
}) {
  const tts = useTts('en-US');
  const [playingId, setPlayingId] = useState<string | null>(null);

  // 一覧を離れる（＝プレイヤーへ切替 / 別ページ）ときは読み上げを止める
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function play(composition: Composition) {
    // 同じ行をもう一度押したら停止
    if (playingId === composition.id) {
      tts.cancel();
      setPlayingId(null);
      return;
    }
    const speakIt = () => {
      setPlayingId(composition.id);
      tts.speak(composition.en, {
        onend: () => setPlayingId((cur) => (cur === composition.id ? null : cur)),
      });
    };
    const speaking =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      window.speechSynthesis.speaking;
    if (speaking) {
      // 再生中を止めてから。cancel() 直後の speak() は Chrome が握り潰すので一拍おく
      tts.cancel();
      window.setTimeout(speakIt, 60);
    } else {
      // 何も鳴っていなければ、ユーザー操作の中で即発話（iOS 対策）
      speakIt();
    }
  }

  return (
    <div className="space-y-5">
      <AddCompositionForm courseId={courseId} />

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          例文 <span className="font-mono tabular-nums">{compositions.length}</span> 件
        </h2>
        <ImportCsvDialog courseId={courseId} />
      </div>

      {compositions.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          まだ例文がありません。上のフォームか、CSV一括登録から追加してください。
        </p>
      ) : (
        <ul className="space-y-2">
          {compositions.map((c) => (
            <CompositionRow
              key={c.id}
              composition={c}
              canPlay={tts.supported}
              playing={playingId === c.id}
              onPlay={() => play(c)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddCompositionForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [ja, setJa] = useState('');
  const [en, setEn] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await addComposition({ courseId, ja, en });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setJa('');
      setEn('');
      toast.success('例文を追加しました');
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="add-ja">日本語</Label>
          <Textarea
            id="add-ja"
            value={ja}
            onChange={(e) => setJa(e.target.value)}
            rows={2}
            placeholder="なるほど、理解しました。"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-en">英語</Label>
          <Textarea
            id="add-en"
            value={en}
            onChange={(e) => setEn(e.target.value)}
            rows={2}
            placeholder="I see, that makes sense."
          />
        </div>
      </div>
      <Button onClick={submit} disabled={pending || !ja.trim() || !en.trim()}>
        <Plus className="size-4" />
        {pending ? '追加中…' : '例文を追加'}
      </Button>
    </div>
  );
}

function ImportCsvDialog({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();

  const parsed = parseCompositionsCsv(text);

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
      const res = await importCompositions({ courseId, rows: parsed.rows });
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
            CSVで一括登録
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>CSVで一括登録</DialogTitle>
          <DialogDescription>
            1行 = 「日本語,英語」。スプレッドシートからのタブ区切り貼り付けもそのまま使えます。英文にカンマが入る場合は
            {' "..." '}
            で囲ってください。見出し行があれば自動で除きます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={'なるほど、理解しました。,"I see, that makes sense."\n一旦これで進めましょう。,Let\'s go with this for now.'}
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
            {pending ? '登録中…' : '登録する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompositionRow({
  composition,
  canPlay,
  playing,
  onPlay,
}: {
  composition: Composition;
  canPlay: boolean;
  playing: boolean;
  onPlay: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deleteComposition({ id: composition.id, courseId: composition.course_id });
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
      {canPlay && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onPlay}
          aria-label={playing ? '読み上げを止める' : '読み上げる'}
          className={cn(
            'shrink-0 self-center text-muted-foreground hover:text-foreground',
            playing && 'text-foreground',
          )}
        >
          {playing ? <Square className="animate-pulse" /> : <Volume2 />}
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm">{composition.ja}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{composition.en}</p>
      </div>
      <EditCompositionDialog composition={composition} />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={remove}
        disabled={pending}
        aria-label="この例文を削除"
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function EditCompositionDialog({ composition }: { composition: Composition }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ja, setJa] = useState(composition.ja);
  const [en, setEn] = useState(composition.en);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await updateComposition({
        id: composition.id,
        courseId: composition.course_id,
        ja,
        en,
      });
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
        if (o) {
          setJa(composition.ja);
          setEn(composition.en);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="この例文を編集"
            className="shrink-0 text-muted-foreground"
          >
            <Pencil />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>例文を編集</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`edit-ja-${composition.id}`}>日本語</Label>
            <Textarea
              id={`edit-ja-${composition.id}`}
              value={ja}
              onChange={(e) => setJa(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-en-${composition.id}`}>英語</Label>
            <Textarea
              id={`edit-en-${composition.id}`}
              value={en}
              onChange={(e) => setEn(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !ja.trim() || !en.trim()}>
            {pending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
