'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { STUDY_MAX_SEC, STUDY_STALE_SEC, elapsedSec, endedAtFrom, jstDateOf, jstIsoFrom } from '@/lib/study';
import type { StudyKind } from '@/types/database';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 計測中の1本を閉じる。
 *
 * 6時間を超えていたら「終了ボタンの押し忘れ」とみなし、**0分**で締めて印を付ける。
 * 本当に何分やったかは誰も知らないので、それらしい時間を作らない。
 * 印の付いた行はダッシュボードの先頭に出て、本人が実際の時間に直す。
 */
async function closeRunning(supabase: Supabase): Promise<{ closed: boolean; autoClosed: boolean }> {
  const { data: running } = await supabase
    .from('study_sessions')
    .select('id, started_at')
    .is('ended_at', null)
    .maybeSingle();

  if (!running) return { closed: false, autoClosed: false };

  const autoClosed = elapsedSec(running.started_at) > STUDY_STALE_SEC;
  await supabase
    .from('study_sessions')
    .update(
      autoClosed
        ? { ended_at: running.started_at, auto_closed: true }
        : { ended_at: new Date().toISOString() },
    )
    .eq('id', running.id);

  return { closed: true, autoClosed };
}

/** 学習の開始。前の計測が残っていれば必ず閉じてから始める（計測中は常に1本）。 */
export async function startStudySession(
  kind: StudyKind,
): Promise<ActionResult<{ id: string; switched: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { closed } = await closeRunning(supabase);

  const { data, error } = await supabase
    .from('study_sessions')
    .insert({ user_id: user.id, kind })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, data: { id: data.id, switched: closed } };
}

/** 学習の終了。計測中が無ければ何もしない（連打・別タブでの終了と競合しても壊れない）。 */
export async function stopStudySession(): Promise<ActionResult<{ autoClosed: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { autoClosed } = await closeRunning(supabase);

  revalidatePath('/', 'layout');
  return { ok: true, data: { autoClosed } };
}

/**
 * あとから直す。開始時刻（JST の時:分）と学習時間（分）を受け取り、
 * ended_at を「開始 + 時間」で作り直す。日付は元の行の開始日を動かさない。
 */
export async function adjustStudySession(input: {
  id: string;
  startTime: string;
  durationMin: number;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const durationSec = Math.round(input.durationMin * 60);
  if (!Number.isFinite(durationSec) || durationSec < 0) {
    return { ok: false, error: '学習時間は0分以上で入れてください' };
  }
  if (durationSec > STUDY_MAX_SEC) {
    return { ok: false, error: `学習時間は${STUDY_MAX_SEC / 3600}時間までです` };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('study_sessions')
    .select('id, started_at, ended_at')
    .eq('id', input.id)
    .maybeSingle();

  if (!row) return { ok: false, error: '記録が見つかりません' };
  if (!row.ended_at) return { ok: false, error: '計測中の記録は、終了してから直してください' };

  const startedAt = jstIsoFrom(jstDateOf(row.started_at), input.startTime);
  if (!startedAt) return { ok: false, error: '開始時刻の形式が不正です' };

  const endedAt = endedAtFrom(startedAt, durationSec);
  if (!endedAt) return { ok: false, error: '終了時刻を計算できませんでした' };

  const { error } = await supabase
    .from('study_sessions')
    .update({
      started_at: startedAt,
      ended_at: endedAt,
      auto_closed: false,
      adjusted_at: new Date().toISOString(),
    })
    .eq('id', input.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}

/** 誤って開始した記録を消す。0分で残すより消したほうが一覧が読める。 */
export async function deleteStudySession(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { error } = await supabase.from('study_sessions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}
