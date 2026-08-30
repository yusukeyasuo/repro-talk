'use client';

import { Pencil, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { adjustStudySession, deleteStudySession } from '@/app/actions/study';
import { Badge } from '@/components/ui/badge';
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
import {
  STUDY_KIND_LABELS,
  STUDY_MAX_SEC,
  formatDurationHm,
  jstDateOf,
  jstTimeOf,
} from '@/lib/study';
import { cn } from '@/lib/utils';
import type { StudySession } from '@/types/database';

/** 'YYYY-MM-DD' を「8/29(金)」にする。今日・昨日は言葉で出す。 */
function formatDayLabel(date: string, today: string): string {
  if (date === today) return '今日';
  const [y, m, d] = date.split('-').map(Number);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}/${d}(${weekday})`;
}

/** today は「今日」ラベル用。サーバから渡してページの他の集計と同じ日付に揃える。 */
export function StudyLog({ sessions, today }: { sessions: StudySession[]; today: string }) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        まだ記録がありません。各学習のページで「開始」を押すと、ここに時間が残ります。
      </p>
    );
  }

  // 日付ごとにまとめる（sessions は開始の新しい順で渡ってくる）
  const days: { date: string; rows: StudySession[] }[] = [];
  for (const session of sessions) {
    const date = jstDateOf(session.started_at);
    const last = days.at(-1);
    if (last?.date === date) last.rows.push(session);
    else days.push({ date, rows: [session] });
  }

  const needsFix = sessions.filter((s) => s.auto_closed).length;

  return (
    <div className="space-y-4">
      {/* 本文は1つの span にまとめる。flex の直下に裸のテキストを並べると、
          それぞれが別の要素として折り返されて読みにくくなる。 */}
      {needsFix > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          <span>
            終了し忘れが <span className="font-mono">{needsFix}</span> 件あります。実際の時間に直すと記録に入ります。
          </span>
        </p>
      )}

      {days.map(({ date, rows }) => {
        const total = rows.reduce((sum, row) => sum + row.duration_sec, 0);
        return (
          <div key={date} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">
                {formatDayLabel(date, today)}
              </p>
              <p className="text-xs text-muted-foreground">合計 {formatDurationHm(total)}</p>
            </div>
            <ul className="divide-y rounded-xl border">
              {rows.map((row) => (
                <li key={row.id}>
                  <StudyRow session={row} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function StudyRow({ session }: { session: StudySession }) {
  const startTime = jstTimeOf(session.started_at);
  const endTime = session.ended_at ? jstTimeOf(session.ended_at) : '';

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{STUDY_KIND_LABELS[session.kind]}</span>
          {session.auto_closed && (
            <Badge variant="secondary" className="text-amber-700 dark:text-amber-500">
              終了し忘れ
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {startTime}
            {endTime && `–${endTime}`}
          </span>
        </p>
      </div>

      <p
        className={cn(
          'shrink-0 text-sm',
          session.auto_closed && 'text-amber-700 dark:text-amber-500',
        )}
      >
        {formatDurationHm(session.duration_sec)}
      </p>

      <AdjustDialog session={session} />
    </div>
  );
}

/** 終了ボタンの押し忘れを直す。開始時刻と学習時間だけを触り、終了時刻は計算で出す。 */
function AdjustDialog({ session }: { session: StudySession }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState(() => jstTimeOf(session.started_at));
  const [minutes, setMinutes] = useState(() => String(Math.round(session.duration_sec / 60)));
  const [pending, startTransition] = useTransition();

  const parsed = Number(minutes);
  const valid =
    /^\d{2}:\d{2}$/.test(startTime) &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= STUDY_MAX_SEC / 60;

  function save() {
    startTransition(async () => {
      const res = await adjustStudySession({
        id: session.id,
        startTime,
        durationMin: parsed,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('学習時間を直しました');
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteStudySession(session.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('記録を削除しました');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // 開くたびにサーバの値へ戻す（前回の入力を引きずらない）
          setStartTime(jstTimeOf(session.started_at));
          setMinutes(String(Math.round(session.duration_sec / 60)));
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="学習時間を直す">
            <Pencil />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{STUDY_KIND_LABELS[session.kind]}の学習時間</DialogTitle>
          <DialogDescription>
            終了を押し忘れたときはここで直します。日付（{jstDateOf(session.started_at)}）は変わりません。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`start-${session.id}`}>開始時刻</Label>
            <Input
              id={`start-${session.id}`}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`minutes-${session.id}`}>学習時間（分）</Label>
            <Input
              id={`minutes-${session.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={STUDY_MAX_SEC / 60}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={remove}
            disabled={pending}
          >
            削除
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={save} disabled={pending || !valid}>
              {pending && <Spinner />}
              {pending ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
