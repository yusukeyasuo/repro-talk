'use client';

import { Pencil, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteCourse, updateCourse } from '@/app/actions/compositions';
import { CompositionManager } from '@/components/composition/composition-manager';
import { CompositionPlayer, type PlayOrder } from '@/components/composition/composition-player';
import { primeSpeech } from '@/hooks/use-tts';
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
import { cn } from '@/lib/utils';
import type { Composition, CompositionCourse } from '@/types/database';

const SETTINGS_KEY = 'composition-play-settings';
const DEFAULT_INTERVAL = 10;

export function CourseScreen({
  course,
  compositions,
}: {
  course: CompositionCourse;
  compositions: Composition[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'play'>('idle');
  const [order, setOrder] = useState<PlayOrder>('seq');
  const [intervalSec, setIntervalSec] = useState(DEFAULT_INTERVAL);

  // 前回の設定（順番・秒数）を localStorage から復元する。DB には持たない。
  // localStorage は外部ストア。SSR と初期HTMLは既定値で描き、マウント後に一度だけ同期する
  // （読み書き両用なので useSyncExternalStore ではなくこの形。effect 内 setState は意図的）。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { order?: string; intervalSec?: number };
      if (s.order === 'seq' || s.order === 'random') setOrder(s.order);
      if (typeof s.intervalSec === 'number') {
        setIntervalSec(Math.min(15, Math.max(3, Math.round(s.intervalSec))));
      }
    } catch {
      // 壊れていたら既定のまま
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function persist(next: { order?: PlayOrder; intervalSec?: number }) {
    const merged = {
      order: next.order ?? order,
      intervalSec: next.intervalSec ?? intervalSec,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    } catch {
      // localStorage 不可でも動作は続ける
    }
  }

  function exitPlayer() {
    setMode('idle');
    router.refresh(); // 回数・連続日数を更新
  }

  const empty = compositions.length === 0;

  if (mode === 'play') {
    return (
      <CompositionPlayer
        courseId={course.id}
        courseTitle={course.title}
        compositions={compositions}
        order={order}
        intervalSec={intervalSec}
        onExit={exitPlayer}
      />
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href="/compositions" className="text-xs text-muted-foreground hover:underline">
          ← 瞬間英作文
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{course.title}</h1>
            {course.description && (
              <p className="mt-1 text-sm text-muted-foreground">{course.description}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <EditCourseDialog course={course} />
            <DeleteCourseDialog courseId={course.id} title={course.title} />
          </div>
        </div>
      </header>

      {/* 流す設定 */}
      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="text-sm font-medium">流す</h2>

        <div className="space-y-1.5">
          <Label>順番</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['seq', 'random'] as PlayOrder[]).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  setOrder(o);
                  persist({ order: o });
                }}
                className={cn(
                  'rounded-lg border p-3 text-sm transition-colors',
                  order === o ? 'border-foreground bg-accent' : 'hover:bg-accent/50',
                )}
              >
                {o === 'seq' ? '登録順' : 'ランダム'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="interval">切り替え速度</Label>
            <span className="text-sm">
              <span className="font-mono tabular-nums">{intervalSec}</span> 秒
            </span>
          </div>
          <input
            id="interval"
            type="range"
            min={3}
            max={15}
            step={1}
            value={intervalSec}
            onChange={(e) => {
              const v = Number(e.target.value);
              setIntervalSec(v);
              persist({ intervalSec: v });
            }}
            className="w-full [accent-color:var(--color-foreground)]"
          />
          <p className="text-xs text-muted-foreground">
            日本語が出てから答えを表示するまでの「考える時間」。声に出す余裕がある長さに。
          </p>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={() => {
            // 音声合成の解錠は必ずユーザー操作の中で（iOS 対策）。ここが gesture の起点。
            primeSpeech();
            setMode('play');
          }}
          disabled={empty}
        >
          <Play className="size-5" />
          スタート
        </Button>
        {empty && (
          <p className="text-center text-xs text-muted-foreground">
            例文を1件以上登録するとスタートできます。
          </p>
        )}
      </section>

      {/* 例文の管理 */}
      <CompositionManager courseId={course.id} compositions={compositions} />
    </div>
  );
}

function EditCourseDialog({ course }: { course: CompositionCourse }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await updateCourse({ id: course.id, title, description });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('コースを更新しました');
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
          setTitle(course.title);
          setDescription(course.description ?? '');
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="コースを編集">
            <Pencil />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>コースを編集</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-course-title">コース名</Label>
            <Input
              id="edit-course-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-course-desc">説明（任意）</Label>
            <Textarea
              id="edit-course-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim()}>
            {pending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCourseDialog({ courseId, title }: { courseId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deleteCourse({ id: courseId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('コースを削除しました');
      router.push('/compositions');
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="コースを削除"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>コースを削除しますか？</DialogTitle>
          <DialogDescription>
            「{title}」と、その中の例文をすべて削除します。これまでの読み上げ回数（連続日数）は残ります。この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? '削除中…' : '削除する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
