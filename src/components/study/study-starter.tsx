'use client';

import { Play, Square, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { startStudySession, stopStudySession } from '@/app/actions/study';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { STUDY_KIND_LABELS } from '@/lib/study';
import type { StudyKind, StudySession } from '@/types/database';

/**
 * 各学習ページの「開始／終了」。経過時間は画面下の計測中バーが出すので、ここでは出さない
 * （2つの時計を別々に動かさない）。
 *
 * 計測中は常に1本なので、別の学習が走っているときは「切り替えて開始」になる。
 * 前の1本はサーバ側で閉じられる（時間が黙って別の学習に付け替わることはない）。
 */
export function StudyStarter({
  kind,
  running,
}: {
  kind: StudyKind;
  running: StudySession | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isThis = running?.kind === kind;
  // 別の学習が走っているときのラベル（無ければ null）
  const otherLabel = running && running.kind !== kind ? STUDY_KIND_LABELS[running.kind] : null;

  function start() {
    startTransition(async () => {
      const res = await startStudySession(kind);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data.switched
          ? `前の計測を終えて、${STUDY_KIND_LABELS[kind]}の計測を始めました`
          : '計測を始めました',
      );
      router.refresh();
    });
  }

  function stop() {
    startTransition(async () => {
      const res = await stopStudySession();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (isThis) {
    return (
      <div className="flex items-center gap-3 rounded-xl border bg-accent/40 p-4">
        <Timer className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 text-sm">
          学習時間を計測中です
          <span className="ml-2 text-xs text-muted-foreground">経過時間は画面下に出ます</span>
        </p>
        <Button variant="destructive" className="h-9 shrink-0 px-4" onClick={stop} disabled={pending}>
          {pending ? <Spinner /> : <Square className="size-4" />}
          終了
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed p-4">
      <Timer className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {otherLabel ? `${otherLabel}を計測中です` : '学習時間を計測します'}
      </p>
      <Button className="h-9 shrink-0 px-4" onClick={start} disabled={pending}>
        {pending ? <Spinner /> : <Play className="size-4" />}
        {otherLabel ? '切り替えて開始' : '開始'}
      </Button>
    </div>
  );
}
