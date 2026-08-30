/**
 * 学習時間の計測のサーバ側の読み取り。
 *
 * `src/app/actions/study.ts` に置くと 'use server' で公開エンドポイントになってしまうので、
 * サーバコンポーネントからしか呼ばない読み取りはこちらに置く。
 */

import { shiftDate, todayJst } from '@/lib/activity';
import { createClient } from '@/lib/supabase/server';
import type { StudySession } from '@/types/database';

/** 計測中の1本。無ければ null。レイアウト（計測中バー）と各学習ページが読む。 */
export async function getRunningStudySession(): Promise<StudySession | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('study_sessions')
    .select('*')
    .is('ended_at', null)
    .maybeSingle();
  return (data as StudySession | null) ?? null;
}

/**
 * ダッシュボードの「学習の記録」に出す直近ぶん（終了済み・新しい順）。
 * 件数ではなく日数で切る。当日ぶんが端で切れると「今日の学習時間」が過少になる。
 */
export async function getRecentStudySessions(days = 14): Promise<StudySession[]> {
  const since = `${shiftDate(todayJst(), -(days - 1))}T00:00:00+09:00`;
  const supabase = await createClient();
  const { data } = await supabase
    .from('study_sessions')
    .select('*')
    .not('ended_at', 'is', null)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(300);
  return (data ?? []) as StudySession[];
}
