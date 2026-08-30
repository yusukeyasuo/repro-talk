'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { signOut, updateProfile } from '@/app/actions/profile';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const GOALS = [
  { sec: 60, label: '1分' },
  { sec: 180, label: '3分' },
  { sec: 300, label: '5分' },
  { sec: 600, label: '10分' },
];

/** 週の学習時間の目標。0 は「決めない」＝ホームに目標セクションを出さない。 */
const WEEKLY_GOALS = [
  { sec: 0, label: '決めない' },
  { sec: 3 * 3600, label: '3時間' },
  { sec: 5 * 3600, label: '5時間' },
  { sec: 7 * 3600, label: '7時間' },
  { sec: 10 * 3600, label: '10時間' },
  { sec: 14 * 3600, label: '14時間' },
];

export function SettingsForm({
  whyText: initialWhy,
  dailyGoalSec: initialGoal,
  weeklyGoalSec: initialWeeklyGoal,
}: {
  whyText: string;
  dailyGoalSec: number;
  weeklyGoalSec: number;
}) {
  const router = useRouter();
  const [whyText, setWhyText] = useState(initialWhy);
  const [goalSec, setGoalSec] = useState(initialGoal);
  const [weeklyGoalSec, setWeeklyGoalSec] = useState(initialWeeklyGoal);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateProfile({ whyText, dailyGoalSec: goalSec, weeklyGoalSec });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('保存しました');
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Label htmlFor="why">英語の先に、理解したい何か</Label>
        <p className="text-xs text-muted-foreground">
          伸びるのは、英語そのものではなく英語の先に理解したい何かがある人。忘れないようにホームに出し続けます。
        </p>
        <Textarea
          id="why"
          value={whyText}
          onChange={(e) => setWhyText(e.target.value)}
          rows={3}
          placeholder="このYouTuberの話をもっと理解したい／字幕なしでこのドラマを見たい／現地の人と友達になりたい"
        />
      </section>

      <section className="space-y-2">
        <Label>1日の独り言の目標</Label>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((goal) => (
            <button
              key={goal.sec}
              type="button"
              onClick={() => setGoalSec(goal.sec)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                goalSec === goal.sec ? 'border-foreground bg-accent' : 'hover:bg-accent/50',
              )}
            >
              {goal.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          最初は1分で十分です。続けば勝手に伸びます。
        </p>
      </section>

      <section className="space-y-2">
        <Label>週の学習目標時間</Label>
        <div className="flex flex-wrap gap-2">
          {WEEKLY_GOALS.map((goal) => (
            <button
              key={goal.sec}
              type="button"
              onClick={() => setWeeklyGoalSec(goal.sec)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                weeklyGoalSec === goal.sec
                  ? 'border-foreground bg-accent'
                  : 'hover:bg-accent/50',
              )}
            >
              {goal.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          各学習ページの「開始」で計った時間の合計です。週は月曜始まりで、月曜の朝にリセットされます。決めるとホームに進捗が出ます。
        </p>
      </section>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending}>
          {pending && <Spinner />}
          {pending ? '保存中…' : '保存'}
        </Button>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() =>
            startTransition(async () => {
              await signOut();
              router.push('/login');
            })
          }
        >
          ログアウト
        </Button>
      </div>
    </div>
  );
}
