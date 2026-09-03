'use client';

import { Pencil, Play, RotateCcw, Trash2, Volume2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteCourse, updateComposition, updateCourse } from '@/app/actions/compositions';
import { AppliedPracticeDialog } from '@/components/composition/applied-practice-dialog';
import { CompositionManager } from '@/components/composition/composition-manager';
import { CompositionPlayer, type PlayProgress } from '@/components/composition/composition-player';
import { useStudyGuard } from '@/components/study/study-guard';
import { StudyStarter } from '@/components/study/study-starter';
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
import * as speaker from '@/lib/speaker';
import { cn } from '@/lib/utils';
import type { Composition, CompositionCourse, StudySession } from '@/types/database';

type PlayOrder = 'seq' | 'random';
/** 流す対象。'manual' = 自分で入れた例文だけ / 'applied' = AI に作らせた応用だけ。 */
type PlayTarget = 'all' | 'starred' | 'manual' | 'applied';

const TARGETS: { value: PlayTarget; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'starred', label: '★のみ' },
  { value: 'manual', label: '基本のみ' },
  { value: 'applied', label: '応用のみ' },
];

const SETTINGS_KEY = 'composition-play-settings';
const DEFAULT_INTERVAL = 10;
const progressKey = (courseId: string) => `composition-progress-${courseId}`;

/** 中断位置。ids は実際に再生した順（ランダムでも続きが成立するよう並びごと保存）。 */
type SavedProgress = { ids: string[]; index: number };

function loadProgress(courseId: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(courseId));
    if (!raw) return null;
    const p = JSON.parse(raw) as SavedProgress;
    if (Array.isArray(p.ids) && typeof p.index === 'number') return p;
  } catch {
    // 壊れていたら無視
  }
  return null;
}

/** Fisher-Yates。ランダム順の解決に使う（決定性は不要）。 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function CourseScreen({
  course,
  compositions,
  running,
}: {
  course: CompositionCourse;
  compositions: Composition[];
  /** 計測中の学習（プレイヤー中は本画面ごと差し替わるので、開始ボタンは idle 側に置く） */
  running: StudySession | null;
}) {
  const router = useRouter();
  const { guard, dialog: studyGuardDialog } = useStudyGuard('composition', running);
  const [mode, setMode] = useState<'idle' | 'play'>('idle');
  const [order, setOrder] = useState<PlayOrder>('seq');
  const [target, setTarget] = useState<PlayTarget>('all');
  const [intervalSec, setIntervalSec] = useState(DEFAULT_INTERVAL);
  const [run, setRun] = useState<{ sequence: Composition[]; startIndex: number } | null>(null);
  const [resume, setResume] = useState<SavedProgress | null>(null);

  // ★（重点マーク）の楽観状態。一覧の行トグルと「★のみ」フィルタの両方がこれを見るので、
  // サーバ往復（router.refresh）を待たずに一貫させる。プレイヤー中は本画面が unmount され、
  // 退出時の router.refresh でサーバ値へ寄せ直る。
  const [starredIds, setStarredIds] = useState<Set<string>>(
    () => new Set(compositions.filter((c) => c.starred).map((c) => c.id)),
  );
  // サーバの★集合が変わったら（他の変更で refresh された等）寄せ直す。楽観トグル中は
  // このキーが変わらないので、途中の setState を潰さない。
  const serverStarredKey = compositions
    .filter((c) => c.starred)
    .map((c) => c.id)
    .sort()
    .join(',');
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setStarredIds(new Set(serverStarredKey ? serverStarredKey.split(',') : []));
  }, [serverStarredKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const starredCount = starredIds.size;
  // 応用（AI に作らせて本人が採用した文）と、自分で入れた例文の件数。
  // 「対象」の絞り込みと、応用練習の案内の両方が見る。
  const appliedCount = compositions.reduce((n, c) => (c.source === 'ai' ? n + 1 : n), 0);
  const manualCount = compositions.length - appliedCount;

  // 前回の設定（順番・秒数）を localStorage から復元。DB には持たない。
  // localStorage は外部ストア。SSR と初期HTMLは既定値で描き、マウント後に一度だけ同期する。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { order?: string; target?: string; intervalSec?: number };
      if (s.order === 'seq' || s.order === 'random') setOrder(s.order);
      if (TARGETS.some((t) => t.value === s.target)) setTarget(s.target as PlayTarget);
      if (typeof s.intervalSec === 'number') {
        setIntervalSec(Math.min(15, Math.max(3, Math.round(s.intervalSec))));
      }
    } catch {
      // 壊れていたら既定のまま
    }
  }, []);

  // 中断位置を復元。今の例文集合に照らして妥当なものだけ「続きから」に出す。
  useEffect(() => {
    const p = loadProgress(course.id);
    if (!p) {
      setResume(null);
      return;
    }
    const ids = new Set(compositions.map((c) => c.id));
    const allPresent = p.ids.length > 0 && p.ids.every((id) => ids.has(id));
    if (allPresent && p.index > 0 && p.index < p.ids.length) {
      setResume(p);
    } else {
      // 例文が消えている等でズレたら破棄
      setResume(null);
      if (!allPresent) {
        try {
          localStorage.removeItem(progressKey(course.id));
        } catch {
          // 無視
        }
      }
    }
  }, [course.id, compositions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function persistSettings(next: { order?: PlayOrder; target?: PlayTarget; intervalSec?: number }) {
    const merged = {
      order: next.order ?? order,
      target: next.target ?? target,
      intervalSec: next.intervalSec ?? intervalSec,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    } catch {
      // localStorage 不可でも続行
    }
  }

  // ★のトグル。楽観的に集合を更新し、失敗したら戻す。router.refresh はしない
  // （本画面が持つ starredIds が正なので、待たせずに反映する）。
  function toggleStar(composition: Composition) {
    const next = !starredIds.has(composition.id);
    setStarredIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(composition.id);
      else s.delete(composition.id);
      return s;
    });
    void updateComposition({ id: composition.id, courseId: composition.course_id, starred: next }).then(
      (res) => {
        if (!res.ok) {
          setStarredIds((prev) => {
            const s = new Set(prev);
            if (next) s.delete(composition.id);
            else s.add(composition.id);
            return s;
          });
          toast.error(res.error);
        }
      },
    );
  }

  // 再生列に渡す前に、各例文の starred を楽観状態へ上書きする（サーバ props は refresh まで古い）。
  const withStar = (c: Composition): Composition => ({ ...c, starred: starredIds.has(c.id) });

  // 選んだ「対象」に入る文か。★は楽観状態（starredIds）を見る。
  const matchesTarget = (c: Composition): boolean => {
    if (target === 'starred') return starredIds.has(c.id);
    if (target === 'manual') return c.source !== 'ai';
    if (target === 'applied') return c.source === 'ai';
    return true;
  };

  // 端末で英語の読み上げが鳴るかを、ユーザー操作の中で確かめる（クラウド→失敗時は端末合成）。
  function testVoice() {
    speaker.unlock();
    speaker.speak('Voice test. This is the reading voice.');
  }

  function startFresh() {
    speaker.unlock(); // 解錠は必ずユーザー操作の中で（iOS 対策）
    // 選んだ対象で絞る。登録順は filter で保たれる。
    const pool = compositions.filter(matchesTarget).map(withStar);
    if (pool.length === 0) return; // 念のため（ボタンは無効化済み）
    const seq = order === 'random' ? shuffle(pool) : pool;
    setRun({ sequence: seq, startIndex: 0 });
    setMode('play');
  }

  function startResume() {
    if (!resume) {
      startFresh();
      return;
    }
    speaker.unlock();
    // 再開は保存した並びを再生するだけ（現在の「対象」設定には依らない）。★状態だけ今の値へ寄せる。
    const byId = new Map(compositions.map((c) => [c.id, c]));
    const seq = resume.ids
      .map((id) => byId.get(id))
      .filter((c): c is Composition => !!c)
      .map(withStar);
    const startIndex = Math.min(resume.index, Math.max(0, seq.length - 1));
    setRun({ sequence: seq, startIndex });
    setMode('play');
  }

  function exitPlayer(progress: PlayProgress) {
    const seq = run?.sequence ?? [];
    if (progress.finished || progress.index >= seq.length || progress.index <= 0) {
      // 1周し切った / 位置が端 → 続きは残さない
      try {
        localStorage.removeItem(progressKey(course.id));
      } catch {
        // 無視
      }
      setResume(null);
    } else {
      const saved: SavedProgress = { ids: seq.map((c) => c.id), index: progress.index };
      try {
        localStorage.setItem(progressKey(course.id), JSON.stringify(saved));
      } catch {
        // 無視
      }
      setResume(saved);
    }
    setRun(null);
    setMode('idle');
    router.refresh(); // 回数・連続日数を更新
  }

  const empty = compositions.length === 0;
  const targetCount = compositions.reduce((n, c) => (matchesTarget(c) ? n + 1 : n), 0);
  // 選んだ対象が0件だとスタートできない（★を1つも付けていない・応用がまだ無い等）。
  const canStart = targetCount > 0;
  const targetCounts: Record<PlayTarget, number> = {
    all: compositions.length,
    starred: starredCount,
    manual: manualCount,
    applied: appliedCount,
  };

  if (mode === 'play' && run) {
    // 確認ダイアログはここでも描く。「計測して始める」でドリルへ移る瞬間に
    // 閉じるアニメーションごと unmount されないよう、両方の枝で繋いでおく。
    return (
      <>
        {studyGuardDialog}
        <CompositionPlayer
          courseId={course.id}
          courseTitle={course.title}
          sequence={run.sequence}
          startIndex={run.startIndex}
          intervalSec={intervalSec}
          onExit={exitPlayer}
        />
      </>
    );
  }

  return (
    <div className="space-y-8">
      {studyGuardDialog}

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

      <StudyStarter kind="composition" running={running} />

      {/* 流す設定 */}
      <section className="space-y-4 rounded-xl border p-5">
        <h2 className="text-sm font-medium">流す</h2>

        {resume && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-accent/40 p-3">
            <p className="text-sm">
              前回の続き：
              <span className="font-mono tabular-nums">{resume.index}</span> /{' '}
              <span className="font-mono tabular-nums">{resume.ids.length}</span> 文まで完了
            </p>
            <Button size="sm" onClick={() => guard(startResume)} disabled={empty}>
              <RotateCcw className="size-4" />
              続きから
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>対象</Label>
          <div className="grid grid-cols-2 gap-2">
            {TARGETS.map((t) => {
              const n = targetCounts[t.value];
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={target === t.value}
                  // 0件の対象は選べない（選べてもスタートできないだけなので、押せなくする）
                  disabled={t.value !== 'all' && n === 0}
                  onClick={() => {
                    setTarget(t.value);
                    persistSettings({ target: t.value });
                  }}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    target === t.value ? 'border-foreground bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  {t.label}
                  {t.value !== 'all' && n > 0 && (
                    <span className="font-mono tabular-nums text-muted-foreground">{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            「★のみ」は、もう言える文を飛ばして★を付けた文だけを流します。「応用のみ」は、AI
            に作らせた応用問題だけを流します。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>順番</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['seq', 'random'] as PlayOrder[]).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  setOrder(o);
                  persistSettings({ order: o });
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
              persistSettings({ intervalSec: v });
            }}
            className="w-full [accent-color:var(--color-foreground)]"
          />
          <p className="text-xs text-muted-foreground">
            日本語が出てから答えを表示するまでの「考える時間」。声に出す余裕がある長さに。
          </p>
        </div>

        <Button
          size="lg"
          variant={resume ? 'outline' : 'default'}
          className="w-full"
          onClick={() => guard(startFresh)}
          disabled={!canStart}
        >
          <Play className="size-5" />
          {resume ? '最初から' : 'スタート'}
        </Button>
        {empty ? (
          <p className="text-center text-xs text-muted-foreground">
            例文を1件以上登録するとスタートできます。
          </p>
        ) : (
          !canStart && (
            <p className="text-center text-xs text-muted-foreground">
              {target === 'starred'
                ? '★を付けた例文がありません。下の一覧か、ドリル中に★を付けてください。'
                : target === 'applied'
                  ? 'まだ応用がありません。下の「応用を作る」から追加してください。'
                  : '選んだ対象に流せる例文がありません。'}
            </p>
          )
        )}

        {/* 音が出るか事前に確認できるように（ブラウザの読み上げは端末・音量に依存する） */}
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={testVoice}>
            <Volume2 className="size-4" />
            声のテスト
          </Button>
          <span className="text-xs text-muted-foreground">押して英語が聞こえるか確認</span>
        </div>
      </section>

      {/* 応用練習：コースの型を組み替えた問題を AI に作らせる */}
      <section className="space-y-3 rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">応用練習</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              コースの例文を2〜3文ずつ組み合わせ、主語や目的語を変えた問題を AI
              に作らせます。同じ文を繰り返して丸暗記になってきたら、型のまま応用が効くかを試すために使ってください。
            </p>
          </div>
          <div className="shrink-0">
            <AppliedPracticeDialog
              courseId={course.id}
              seedCount={manualCount}
              // 追加した直後は、そのまま応用だけを流せる状態にしておく
              onRegistered={() => {
                setTarget('applied');
                persistSettings({ target: 'applied' });
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {manualCount < 2 ? (
            <>自分で入れた例文が2件以上あると作れます。</>
          ) : appliedCount > 0 ? (
            <>
              いま応用が <span className="font-mono tabular-nums">{appliedCount}</span>{' '}
              件あります。上の「対象」で「応用のみ」を選ぶと、応用だけを流せます。
            </>
          ) : (
            <>作った問題は、選んだものだけがこのコースに入ります。</>
          )}
        </p>
      </section>

      {/* 例文の管理 */}
      <CompositionManager
        courseId={course.id}
        compositions={compositions}
        starredIds={starredIds}
        onToggleStar={toggleStar}
      />
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
            {pending && <Spinner />}
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
            {pending && <Spinner />}
            {pending ? '削除中…' : '削除する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
