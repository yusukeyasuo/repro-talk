import { ArrowRight, Check, Target } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import type { WeeklyGoalSummary } from '@/lib/activity';
import { formatDurationHm } from '@/lib/study';
import { cn } from '@/lib/utils';

/** 'YYYY-MM-DD' → 'M/D' */
function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/** 目標未設定のときの誘導。Why バナーと同じ扱いで、数字を勝手に決めない。 */
export function WeeklyGoalPrompt({ studySec }: { studySec: number }) {
  return (
    <section className="rounded-xl border border-dashed p-5">
      <p className="text-xs text-muted-foreground">今週の学習</p>
      <p className="mt-1 text-2xl">{formatDurationHm(studySec)}</p>
      <p className="mt-3 text-sm">
        週の学習目標時間を決めると、ここに目標に対する進み具合が出ます。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        nativeButton={false}
        render={<Link href="/settings" />}
      >
        目標を決める
        <ArrowRight className="size-4" />
      </Button>
    </section>
  );
}

export function WeeklyGoal({ summary }: { summary: WeeklyGoalSummary }) {
  const {
    weekStart,
    weekEnd,
    goalSec,
    studySec,
    ratio,
    achieved,
    remainingSec,
    remainingDays,
    perDaySec,
    paceSec,
    behind,
    days,
  } = summary;

  const percent = Math.round(ratio * 100);
  // バーは100%で頭打ち。超過ぶんは数字（パーセント）側で見せる
  const barPercent = Math.min(100, percent);
  const pacePercent = goalSec > 0 ? Math.min(100, Math.round((paceSec / goalSec) * 100)) : 0;

  // 棒グラフの高さの基準。目標どおりの1日ぶん（目標/7）を下限にして、
  // 少ししかやっていない週でも「目標に対してどのくらいか」が分かるようにする
  const scale = Math.max(goalSec / 7, ...days.map((day) => day.studySec), 1);

  return (
    <section className="space-y-4 rounded-xl border p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Target className="size-4" />
          今週の学習
        </h2>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {shortDate(weekStart)}–{shortDate(weekEnd)}
          </span>
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl">
            {formatDurationHm(studySec)}
            <span className="ml-1 text-sm text-muted-foreground">
              / {formatDurationHm(goalSec)}
            </span>
          </p>
          <p className={cn('text-sm', achieved && 'font-medium')}>
            <span className="font-mono tabular-nums">{percent}</span>%
          </p>
        </div>

        {/* 進捗バー。ペース（今日の終わりまでの目安）の位置に目盛りを立てる */}
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full transition-[width]',
              achieved ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-foreground',
            )}
            style={{ width: `${barPercent}%` }}
          />
          {!achieved && pacePercent > 0 && pacePercent < 100 && (
            <div
              className="absolute inset-y-0 w-0.5 bg-background/80"
              style={{ left: `${pacePercent}%` }}
              aria-hidden
            />
          )}
        </div>
      </div>

      {achieved ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-500">
          <Check className="size-4" />
          今週の目標を達成しました。
          {studySec > goalSec && <>超過ぶん {formatDurationHm(studySec - goalSec)}。</>}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          残り {formatDurationHm(remainingSec)}・あと
          <span className="font-mono tabular-nums">{remainingDays}</span> 日（1日あたり{' '}
          {formatDurationHm(perDaySec)}）
          {behind && (
            <span className="ml-1 text-amber-700 dark:text-amber-500">
              今日の終わりまでの目安は {formatDurationHm(paceSec)}
            </span>
          )}
        </p>
      )}

      {/* 曜日ごとの内訳 */}
      <ul className="flex items-end gap-1.5">
        {days.map((day) => (
          <li key={day.date} className="flex flex-1 flex-col items-center gap-1">
            {/* 0分の日も行の高さを保つ（空にすると、その列だけ棒が上にずれる） */}
            <span className="text-[10px] text-muted-foreground">
              {day.studySec > 0 ? Math.round(day.studySec / 60) : ' '}
            </span>
            <div
              className="flex h-14 w-full items-end rounded-[4px] bg-muted"
              title={`${day.date} — ${formatDurationHm(day.studySec)}`}
            >
              <div
                className={cn(
                  'w-full rounded-[4px]',
                  day.isToday ? 'bg-foreground' : 'bg-foreground/45',
                  day.isFuture && 'bg-foreground/10',
                )}
                style={{
                  // 0 のときも 2px 残して「その日があること」を示す
                  height: `${Math.max(day.studySec > 0 ? 8 : 2, Math.round((day.studySec / scale) * 100))}%`,
                }}
              />
            </div>
            <span
              className={cn(
                'text-[10px]',
                day.isToday ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {day.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">数字は分。棒は各曜日の学習時間。</p>
    </section>
  );
}
