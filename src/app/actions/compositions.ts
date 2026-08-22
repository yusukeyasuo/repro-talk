'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import type { CompositionDraft } from '@/lib/composition-csv';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

// --- コース --------------------------------------------------------------

export async function createCourse(input: {
  title: string;
  description?: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'コース名を入れてください' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('composition_courses')
    .insert({ user_id: user.id, title, description: input.description?.trim() || null })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/compositions');
  return { ok: true, data: { id: data.id } };
}

export async function updateCourse(input: {
  id: string;
  title?: string;
  description?: string | null;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const patch: { title?: string; description?: string | null } = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { ok: false, error: 'コース名を入れてください' };
    patch.title = title;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { error } = await supabase.from('composition_courses').update(patch).eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/compositions');
  revalidatePath(`/compositions/${input.id}`);
  return { ok: true, data: undefined };
}

export async function deleteCourse(input: { id: string }): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  // compositions は cascade で消える。composition_logs は course_id が set null
  // になるだけで残る（連続日数の履歴を巻き戻さないため）。
  const { error } = await supabase.from('composition_courses').delete().eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/compositions');
  revalidatePath('/');
  return { ok: true, data: undefined };
}

// --- 例文 ----------------------------------------------------------------

/** その course の末尾に積むための現在の最大 sort_order を返す（無ければ 0）。 */
async function nextSortBase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
): Promise<number> {
  const { data } = await supabase
    .from('compositions')
    .select('sort_order')
    .eq('course_id', courseId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.sort_order ?? 0;
}

/** course が自分のものか（RLS 越しに読めるか）を確認する。他人の course への差し込みを防ぐ。 */
async function ownsCourse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('composition_courses')
    .select('id')
    .eq('id', courseId)
    .maybeSingle();
  return !!data;
}

export async function addComposition(input: {
  courseId: string;
  ja: string;
  en: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const ja = input.ja.trim();
  const en = input.en.trim();
  if (!ja || !en) return { ok: false, error: '日本語と英語の両方を入れてください' };

  const supabase = await createClient();
  if (!(await ownsCourse(supabase, input.courseId))) {
    return { ok: false, error: 'コースが見つかりません' };
  }

  const base = await nextSortBase(supabase, input.courseId);
  const { data, error } = await supabase
    .from('compositions')
    .insert({ user_id: user.id, course_id: input.courseId, ja, en, sort_order: base + 1 })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/compositions/${input.courseId}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateComposition(input: {
  id: string;
  courseId: string;
  ja?: string;
  en?: string;
  /** ★（重点マーク）のトグル。一覧の行・プレイヤーのドリル中の両方から呼ぶ。 */
  starred?: boolean;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const patch: { ja?: string; en?: string; starred?: boolean } = {};
  if (input.ja !== undefined) {
    const ja = input.ja.trim();
    if (!ja) return { ok: false, error: '日本語を入れてください' };
    patch.ja = ja;
  }
  if (input.en !== undefined) {
    const en = input.en.trim();
    if (!en) return { ok: false, error: '英語を入れてください' };
    patch.en = en;
  }
  if (input.starred !== undefined) {
    patch.starred = input.starred;
  }
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { error } = await supabase.from('compositions').update(patch).eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/compositions/${input.courseId}`);
  return { ok: true, data: undefined };
}

export async function deleteComposition(input: {
  id: string;
  courseId: string;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { error } = await supabase.from('compositions').delete().eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/compositions/${input.courseId}`);
  return { ok: true, data: undefined };
}

/** CSV/TSV から起こした複数行を、末尾へまとめて追記する。 */
export async function importCompositions(input: {
  courseId: string;
  rows: CompositionDraft[];
}): Promise<ActionResult<{ added: number }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const rows = input.rows
    .map((r) => ({ ja: r.ja.trim(), en: r.en.trim() }))
    .filter((r) => r.ja && r.en);
  if (rows.length === 0) return { ok: false, error: '登録できる行がありませんでした' };

  const supabase = await createClient();
  if (!(await ownsCourse(supabase, input.courseId))) {
    return { ok: false, error: 'コースが見つかりません' };
  }

  const base = await nextSortBase(supabase, input.courseId);
  const payload = rows.map((r, i) => ({
    user_id: user.id,
    course_id: input.courseId,
    ja: r.ja,
    en: r.en,
    sort_order: base + i + 1,
  }));

  const { error } = await supabase.from('compositions').insert(payload);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/compositions/${input.courseId}`);
  return { ok: true, data: { added: rows.length } };
}

// --- 読み上げ回数の記録 ---------------------------------------------------

/**
 * 読み上げ回数を記録する。1文再生 = 1回として、プレイヤーが都度（repCount:1）呼ぶ。
 * 途中で止めても、そこまで再生した文数が残る。ダッシュボード（/）は force-dynamic なので
 * revalidate は不要（毎回 daily_activity を引き直す）。
 */
export async function logCompositionReps(input: {
  courseId: string;
  repCount: number;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;
  if (input.repCount <= 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { error } = await supabase.from('composition_logs').insert({
    user_id: user.id,
    course_id: input.courseId,
    rep_count: Math.round(input.repCount),
  });

  if (error) return { ok: false, error: error.message };

  return { ok: true, data: undefined };
}
