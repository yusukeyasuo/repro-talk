'use client';

import { Square, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore, useTransition } from 'react';
import { toast } from 'sonner';

import { stopStudySession } from '@/app/actions/study';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  STUDY_KIND_LABELS,
  STUDY_STALE_SEC,
  elapsedSec,
  formatClock,
  formatDurationHm,
} from '@/lib/study';
import { cn } from '@/lib/utils';
import type { StudySession } from '@/types/database';

/**
 * 秒刻みの「今」。時刻は React の外にある値なので useSyncExternalStore で読む。
 * サーバでは 0 を返し、ハイドレーション後に本物へ切り替わる（時計のズレで警告が出ない）。
 */
function useNowMs(): number {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 1000);
      return () => clearInterval(id);
    },
    // 秒に丸めることで、同じ1秒の間は同じ値＝再レンダリングのループにならない
    () => Math.floor(Date.now() / 1000) * 1000,
    () => 0,
  );
}

/**
 * 全ページ共通の「計測中」バー。
 *
 * 学習中に素材一覧へ戻ったり、瞬間英作文のプレイヤーへ入ったりしても、
 * ここから終了できる。経過時間は開始時刻との差なので、リロードしても続く。
 */
export function StudyBar({ session }: { session: StudySession | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nowMs = useNowMs();

  if (!session) return null;

  // nowMs が 0 の間（サーバ描画・ハイドレーション直後）は時計を出さない
  const sec = nowMs === 0 ? null : elapsedSec(session.started_at, nowMs);
  const stale = sec !== null && sec > STUDY_STALE_SEC;

  function stop() {
    startTransition(async () => {
      const res = await stopStudySession();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.autoClosed) {
        toast.warning('6時間を超えていたので0分で記録しました。ホームで実際の時間に直せます');
      } else if (sec !== null) {
        toast.success(`${formatDurationHm(sec)} 記録しました`);
      }
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        'border-t bg-background/95 backdrop-blur',
        stale && 'bg-amber-50/95 dark:bg-amber-950/40',
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 md:px-6">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/40" />
          <span className="relative inline-flex size-2.5 rounded-full bg-foreground" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {STUDY_KIND_LABELS[session.kind]} を計測中
          </p>
          {stale && (
            <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
              <TriangleAlert className="size-3" />
              6時間を超えています。終了し忘れかもしれません
            </p>
          )}
        </div>

        <span className="font-mono text-lg tabular-nums" aria-label="経過時間">
          {sec === null ? '--:--' : formatClock(sec)}
        </span>

        <Button
          variant="destructive"
          className="h-9 shrink-0 px-4"
          onClick={stop}
          disabled={pending}
        >
          {pending ? <Spinner /> : <Square className="size-4" />}
          終了
        </Button>
      </div>
    </div>
  );
}
