import { ArrowRight, Flame, Mic, Repeat2 } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Heatmap } from '@/components/dashboard/heatmap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildHeatmap, calcStreak, hasActivity, shiftDate, todayJst } from '@/lib/activity';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { formatDurationJa } from '@/lib/youtube';
import type { Clip, DailyActivity, Profile } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const today = todayJst();
  const since = shiftDate(today, -120);
  const supabase = await createClient();

  const [{ data: activity }, { data: profile }, { data: recentClips }, { count: phraseCount }] =
    await Promise.all([
      supabase
        .from('daily_activity')
        .select('*')
        .gte('activity_date', since)
        .order('activity_date', { ascending: false }),
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase
        .from('clips')
        .select('id, label, transcript, material_id')
        .order('updated_at', { ascending: false })
        .limit(1),
      supabase.from('phrases').select('id', { count: 'exact', head: true }).eq('used_count', 0),
    ]);

  const rows = (activity ?? []) as DailyActivity[];
  const byDate = new Map(rows.map((row) => [row.activity_date, row]));
  const todayRow = byDate.get(today);
  const streak = calcStreak(rows, today);
  const heatmap = buildHeatmap(rows, 12, today);

  const weekStart = shiftDate(today, -6);
  const weekRows = rows.filter((row) => row.activity_date >= weekStart);
  const weekMonologueSec = weekRows.reduce((sum, row) => sum + row.monologue_sec, 0);
  const weekReps = weekRows.reduce((sum, row) => sum + row.reproduction_reps, 0);

  const why = (profile as Profile | null)?.why_text;
  const goalSec = (profile as Profile | null)?.daily_goal_sec ?? 60;
  const lastClip = (recentClips ?? [])[0] as Pick<
    Clip,
    'id' | 'label' | 'transcript' | 'material_id'
  > | undefined;

  const reproDone = (todayRow?.reproduction_reps ?? 0) > 0;
  const monologueDone = (todayRow?.monologue_sec ?? 0) >= goalSec;

  return (
    <div className="space-y-8">
      {/* 英語の先にある何か */}
      {why ? (
        <section className="rounded-xl border bg-accent/40 p-5">
          <p className="text-xs text-muted-foreground">英語の先に、理解したい何か</p>
          <p className="mt-1 text-base">{why}</p>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed p-5">
          <p className="text-sm">
            英語の先に理解したい何かを決めると、続く確率が変わります。
          </p>
          <Button variant="outline" size="sm" className="mt-3" nativeButton={false} render={<Link href="/settings" />}>
            決めておく
            <ArrowRight className="size-4" />
          </Button>
        </section>
      )}

      {/* 今日やること */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">今日やること</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={lastClip ? `/clips/${lastClip.id}` : '/materials'}
            className="group rounded-xl border p-5 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <Repeat2 className="size-4" />
              <span className="text-sm font-medium">リプロダクション</span>
              {reproDone && <Badge variant="secondary" className="ml-auto">今日済み</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              完成された英語を 100 のまま受け取る。1文再生 → 止める → 同じように言う。
            </p>
            <p className="mt-2 line-clamp-1 text-sm">
              {lastClip
                ? lastClip.label || lastClip.transcript || '前回のクリップを続ける'
                : 'まず素材を1本登録する'}
            </p>
          </Link>

          <Link
            href="/monologue"
            className="group rounded-xl border p-5 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <Mic className="size-4" />
              <span className="text-sm font-medium">独り言</span>
              {monologueDone && <Badge variant="secondary" className="ml-auto">今日済み</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              自力で 0 から英語を作り出す。歩きながら「1人電話」。
            </p>
            <p className="mt-2 text-sm">
              今日 {formatDurationJa(todayRow?.monologue_sec ?? 0)} / 目標{' '}
              {formatDurationJa(goalSec)}
            </p>
          </Link>
        </div>
      </section>

      {/* 記録 */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium">続いている記録</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame className="size-3.5" />
              連続日数
            </p>
            <p className="mt-1 text-2xl">
              <span className="font-mono tabular-nums">{streak}</span> 日
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">今週の独り言</p>
            <p className="mt-1 text-2xl">{formatDurationJa(weekMonologueSec)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">今週のリプロダクション</p>
            <p className="mt-1 text-2xl">
              <span className="font-mono tabular-nums">{weekReps}</span> 回
            </p>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <Heatmap columns={heatmap} today={today} />
          <p className="mt-3 text-xs text-muted-foreground">
            {hasActivity(todayRow)
              ? '今日はもう動かしました。'
              : '1分でいい。始めることが全部のスタートです。'}
          </p>
        </div>
      </section>

      {(phraseCount ?? 0) > 0 && (
        <section className="rounded-xl border p-5">
          <p className="text-sm">
            まだ口から出していないフレーズが{' '}
            <span className="font-mono">{phraseCount}</span> 件あります。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            リプロダクションで入れた 100 を、独り言の 0 から出せたときに繋がります。
          </p>
          <Button variant="outline" size="sm" className="mt-3" nativeButton={false} render={<Link href="/monologue" />}>
            独り言で使う
            <ArrowRight className="size-4" />
          </Button>
        </section>
      )}
    </div>
  );
}
