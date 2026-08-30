'use client';

import { Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { startStudySession } from '@/app/actions/study';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { STUDY_KIND_LABELS } from '@/lib/study';
import type { StudyKind, StudySession } from '@/types/database';

/**
 * 「計測を始めずに学習を始めようとした」ときに一度だけ確認する。
 *
 * 計測の開始ボタンは押し忘れる。押し忘れたまま練習すると、その時間はどこにも残らない
 * （`study_sessions` に行が無いので、あとから直すこともできない）。だから練習を始める
 * 操作そのものを入口にして、その場で計測を始められるようにする。
 *
 * 別の学習を計測中のときも訊く。黙って進めると、この練習の時間が別の種類として残る。
 *
 * 「このまま始める」を選んだら、この画面にいる間は二度と訊かない。判断は1回の学習に
 * つき1回で足りる（ref なので `router.refresh()` を跨いでも保つ）。画面を離れて
 * 戻れば次の学習の始まりなので、そこでまた訊く。
 */
export function useStudyGuard(
  kind: StudyKind,
  running: StudySession | null,
): { guard: (action: () => void) => void; dialog: ReactNode } {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  // 保留中の操作。setState に関数をそのまま渡すと更新関数として呼ばれるので ref で持つ
  const actionRef = useRef<(() => void) | null>(null);
  const dismissedRef = useRef(false);

  const measuring = running?.kind === kind;
  const otherLabel = running && running.kind !== kind ? STUDY_KIND_LABELS[running.kind] : null;

  const guard = useCallback(
    (action: () => void) => {
      if (measuring || dismissedRef.current) {
        action();
        return;
      }
      actionRef.current = action;
      setAsking(true);
    },
    [measuring],
  );

  /**
   * 保留していた操作を走らせる。
   * iOS は読み上げの解錠もマイクの許可も「ユーザー操作の中」でしか通さないので、
   * await を挟まずここで先に走らせる（計測の開始はその後ろに回す）。
   */
  function run() {
    const action = actionRef.current;
    actionRef.current = null;
    setAsking(false);
    action?.();
  }

  function startWithTimer() {
    run();
    void startStudySession(kind).then((res) => {
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

  function startWithoutTimer() {
    dismissedRef.current = true;
    run();
  }

  const dialog = (
    <Dialog
      open={asking}
      onOpenChange={(open) => {
        // × や背景でのクローズは「やめる」。保留した操作は走らせない
        if (!open) actionRef.current = null;
        setAsking(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>計測せずに始めますか？</DialogTitle>
          <DialogDescription>
            {otherLabel
              ? `いま${otherLabel}を計測中です。このまま始めると、これからの時間が${otherLabel}として残ります。`
              : `学習時間の計測が始まっていません。このまま始めると、この${STUDY_KIND_LABELS[kind]}の時間は記録に残りません（あとから足すこともできません）。`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={startWithoutTimer}>
            このまま始める
          </Button>
          <Button className="h-11" onClick={startWithTimer}>
            <Timer className="size-4" />
            {otherLabel ? '切り替えて計測' : '計測して始める'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { guard, dialog };
}
