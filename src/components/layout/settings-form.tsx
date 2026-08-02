'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { signOut, updateProfile } from '@/app/actions/profile';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const GOALS = [
  { sec: 60, label: '1分' },
  { sec: 180, label: '3分' },
  { sec: 300, label: '5分' },
  { sec: 600, label: '10分' },
];

export function SettingsForm({
  whyText: initialWhy,
  dailyGoalSec: initialGoal,
}: {
  whyText: string;
  dailyGoalSec: number;
}) {
  const router = useRouter();
  const [whyText, setWhyText] = useState(initialWhy);
  const [goalSec, setGoalSec] = useState(initialGoal);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateProfile({ whyText, dailyGoalSec: goalSec });
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

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending}>
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
