'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import type { MonologueTopicDraft } from '@/lib/monologue-topic-csv';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { AiSuggestion, MonologueMode } from '@/types/database';

/** 最初から入っている30個のお題は共通シードなので、本人には直せない。 */
const NOT_OWN_TOPIC = '最初から入っているお題は編集・削除できません';

/** お題はお題一覧と独り言ページの両方に出るので、まとめて貼り替える。 */
function revalidateTopics() {
  revalidatePath('/monologue');
  revalidatePath('/monologue/topics');
}

/** 独り言を1回終えたときに記録する。長さそのものが「やった事実」。 */
export async function saveMonologueSession(input: {
  topicId: string | null;
  mode: MonologueMode;
  durationSec: number;
  usedPhraseIds: string[];
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monologue_sessions')
    .insert({
      user_id: user.id,
      topic_id: input.topicId,
      mode: input.mode,
      duration_sec: Math.max(0, Math.round(input.durationSec)),
      used_phrase_ids: input.usedPhraseIds,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  revalidatePath('/monologue');
  return { ok: true, data: { id: data.id } };
}

/** 「言えなかったこと」のメモと、それに対する AI の英語表現を保存する。 */
export async function saveMonologueFeedback(input: {
  sessionId: string;
  jaMemo: string;
  suggestions: AiSuggestion[];
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { error } = await supabase
    .from('monologue_sessions')
    .update({ ja_memo: input.jaMemo, ai_suggestions: input.suggestions })
    .eq('id', input.sessionId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/monologue');
  return { ok: true, data: undefined };
}

/** お題の文言を整えて返す。両方入っていなければ理由を返す。 */
function normalizeTopicInput(input: { titleEn: string; titleJa: string }) {
  const titleEn = input.titleEn.trim();
  const titleJa = input.titleJa.trim();
  if (!titleEn || !titleJa) {
    return { ok: false as const, error: 'お題は英語・日本語の両方を入れてください' };
  }
  return { ok: true as const, titleEn, titleJa };
}

/**
 * 自分のお題に付ける次の sort_order。共通シードは 1〜30 を使っているので、
 * 1000 番台に積んで必ずシードの後ろに並ぶようにする。
 */
async function nextTopicSortOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from('monologue_topics')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  return Math.max(1000, (data?.sort_order ?? 0) + 1);
}

/** 自分のお題を1件追加する。 */
export async function addCustomTopic(input: {
  titleEn: string;
  titleJa: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const normalized = normalizeTopicInput(input);
  if (!normalized.ok) return normalized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monologue_topics')
    .insert({
      user_id: user.id,
      title_en: normalized.titleEn,
      title_ja: normalized.titleJa,
      sort_order: await nextTopicSortOrder(supabase, user.id),
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidateTopics();
  return { ok: true, data: { id: data.id } };
}

/**
 * 自分のお題の文言を直す。共通シードは RLS で弾かれるが、その場合エラーではなく
 * 0行更新になって黙って成功したように見えるので、返ってきた行数で判定する。
 */
export async function updateCustomTopic(input: {
  id: string;
  titleEn: string;
  titleJa: string;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const normalized = normalizeTopicInput(input);
  if (!normalized.ok) return normalized;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monologue_topics')
    .update({ title_en: normalized.titleEn, title_ja: normalized.titleJa })
    .eq('id', input.id)
    .eq('user_id', user.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: NOT_OWN_TOPIC };

  revalidateTopics();
  return { ok: true, data: undefined };
}

/** 自分のお題を消す。過去の独り言の記録は topic_id が null になるだけで残る。 */
export async function deleteCustomTopic(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monologue_topics')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: NOT_OWN_TOPIC };

  revalidateTopics();
  return { ok: true, data: undefined };
}

/** スプレッドシートからの貼り付けで、自分のお題をまとめて登録する。 */
export async function importCustomTopics(input: {
  rows: MonologueTopicDraft[];
}): Promise<ActionResult<{ added: number }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const rows = input.rows
    .map((row) => ({ titleEn: row.titleEn.trim(), titleJa: row.titleJa.trim() }))
    .filter((row) => row.titleEn && row.titleJa);
  if (rows.length === 0) return { ok: false, error: '登録できる行がありませんでした' };

  const supabase = await createClient();
  const base = await nextTopicSortOrder(supabase, user.id);

  const { error } = await supabase.from('monologue_topics').insert(
    rows.map((row, i) => ({
      user_id: user.id,
      title_en: row.titleEn,
      title_ja: row.titleJa,
      sort_order: base + i,
    })),
  );

  if (error) return { ok: false, error: error.message };

  revalidateTopics();
  return { ok: true, data: { added: rows.length } };
}
