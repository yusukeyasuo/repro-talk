import { ArrowRight, Flame, Mic, Repeat2, Zap } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Heatmap } from '@/components/dashboard/heatmap';
import { WeeklyGoal, WeeklyGoalPrompt } from '@/components/dashboard/weekly-goal';
import { StudyLog } from '@/components/study/study-log';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  buildHeatmap,
  calcStreak,
  hasActivity,
  shiftDate,
  summarizeWeeklyGoal,
  todayJst,
} from '@/lib/activity';
import { formatDurationHm, jstDateOf } from '@/lib/study';
import { getRecentStudySessions } from '@/lib/study-server';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { formatDurationJa } from '@/lib/youtube';
import type { Clip, DailyActivity, Profile, StudyKind } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const today = todayJst();
  const since = shiftDate(today, -120);
  const supabase = await createClient();

  const [
    { data: activity },
    { data: profile },
    { data: recentClips },
    { count: phraseCount },
    studySessions,
  ] = await Promise.all([
    supabase
      .from('daily_activity')
      .select('*')
      .gte('activity_date', since)
      .order('activity_date', { ascending: false }),
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('clips')
      .select('id, label, transcript, annotations, material_id')
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('phrases').select('id', { count: 'exact', head: true }).is('graduated_at', null),
    getRecentStudySessions(14),
  ]);

  const rows = (activity ?? []) as DailyActivity[];
  const byDate = new Map(rows.map((row) => [row.activity_date, row]));
  const todayRow = byDate.get(today);
  const streak = calcStreak(rows, today);
  const heatmap = buildHeatmap(rows, 12, today);

  const why = (profile as Profile | null)?.why_text;
  const goalSec = (profile as Profile | null)?.daily_goal_sec ?? 60;
  const weeklyGoalSec = (profile as Profile | null)?.weekly_goal_sec ?? 0;

  // 「今週」は月曜始まりの暦週。目標の区切りと画面内の集計をすべてこれに揃える
  // （ローリング7日と混ぜると、同じ画面で「今週」が2つの意味になる）。
  const weekly = summarizeWeeklyGoal(rows, weeklyGoalSec, today);
  const weekRows = rows.filter(
    (row) => row.activity_date >= weekly.weekStart && row.activity_date <= weekly.weekEnd,
  );
  const weekMonologueSec = weekRows.reduce((sum, row) => sum + row.monologue_sec, 0);
  const weekReps = weekRows.reduce((sum, row) => sum + row.reproduction_reps, 0);
  const weekCompositionReps = weekRows.reduce((sum, row) => sum + row.composition_reps, 0);

  // 今日の学習時間を導線ごとに出す（daily_activity は種類をまとめてしまうので明細から数える）
  const todayStudySec: Record<StudyKind, number> = {
    reproduction: 0,
    monologue: 0,
    composition: 0,
  };
  for (const session of studySessions) {
    if (jstDateOf(session.started_at) === today) {
      todayStudySec[session.kind] += session.duration_sec;
    }
  }

  const recent = (recentClips ?? []) as Pick<
    Clip,
    'id' | 'label' | 'transcript' | 'annotations' | 'material_id'
  >[];
  // 作りかけ = スクリプトは入っているが記号がまだ付いていないクリップ。
  // クリップは使い捨てなので、仕上げたものには出戻りさせず新規の切り出しへ促す。
  const unfinished = recent.find((clip) => clip.transcript && (clip.annotations?.length ?? 0) === 0);
  const reproHref = unfinished ? `/clips/${unfinished.id}` : '/materials';
  const reproLabel = unfinished
    ? unfinished.label || unfinished.transcript || '作りかけを仕上げる'
    : recent.length === 0
      ? 'まず素材を1本登録する'
      : '新しく切り出す';

  const reproDone = (todayRow?.reproduction_reps ?? 0) > 0;
  const monologueDone = (todayRow?.monologue_sec ?? 0) >= goalSec;
  const todayCompositionReps = todayRow?.composition_reps ?? 0;
  const compositionDone = todayCompositionReps > 0;

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
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href={reproHref}
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
            <p className="mt-2 line-clamp-1 text-sm">{reproLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              今日の学習 {formatDurationHm(todayStudySec.reproduction)}
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
            <p className="mt-1 text-xs text-muted-foreground">
              今日の学習 {formatDurationHm(todayStudySec.monologue)}
            </p>
          </Link>

          <Link
            href="/compositions"
            className="group rounded-xl border p-5 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2">
              <Zap className="size-4" />
              <span className="text-sm font-medium">瞬間英作文</span>
              {compositionDone && <Badge variant="secondary" className="ml-auto">今日済み</Badge>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              日本語を見た瞬間に英語を。コースを選んで流す。
            </p>
            <p className="mt-2 text-sm">
              今日 <span className="font-mono tabular-nums">{todayCompositionReps}</span> 回
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              今日の学習 {formatDurationHm(todayStudySec.composition)}
            </p>
          </Link>
        </div>
      </section>

      {/* 週の目標。学習時間そのものはここが持つ（下の「今週の…」は回数・話した時間） */}
      {weeklyGoalSec > 0 ? (
        <WeeklyGoal summary={weekly} />
      ) : (
        <WeeklyGoalPrompt studySec={weekly.studySec} />
      )}

      {/* 記録 */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium">続いている記録</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">今週の瞬間英作文</p>
            <p className="mt-1 text-2xl">
              <span className="font-mono tabular-nums">{weekCompositionReps}</span> 回
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

      {/* 学習時間の明細。終了ボタンの押し忘れはここで直す。 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">学習の記録</h2>
          <p className="text-xs text-muted-foreground">直近14日</p>
        </div>
        <StudyLog sessions={studySessions} today={today} />
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/monologue" />}>
              独り言で使う
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/phrases" />}>
              フレーズ一覧
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
