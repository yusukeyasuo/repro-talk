'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { AiSuggestion, MonologueMode } from '@/types/database';

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

export async function addCustomTopic(input: {
  titleEn: string;
  titleJa: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const titleEn = input.titleEn.trim();
  const titleJa = input.titleJa.trim();
  if (!titleEn || !titleJa) {
    return { ok: false, error: 'お題は英語・日本語の両方を入れてください' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monologue_topics')
    .insert({ user_id: user.id, title_en: titleEn, title_ja: titleJa, sort_order: 1000 })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/monologue');
  return { ok: true, data: { id: data.id } };
}
