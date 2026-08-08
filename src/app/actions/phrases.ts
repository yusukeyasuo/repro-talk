'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export async function addPhrases(input: {
  clipId?: string | null;
  phrases: { text: string; meaning_ja?: string | null }[];
}): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const rows = input.phrases
    .map((p) => ({
      user_id: user.id,
      clip_id: input.clipId ?? null,
      text: p.text.trim(),
      meaning_ja: p.meaning_ja?.trim() || null,
    }))
    .filter((p) => p.text.length > 0);

  if (rows.length === 0) return { ok: true, data: { count: 0 } };

  const supabase = await createClient();
  const { error } = await supabase.from('phrases').insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/phrases');
  revalidatePath('/monologue');
  return { ok: true, data: { count: rows.length } };
}

/**
 * 独り言でそのフレーズを使えたときに呼ぶ。
 * リプロダクションで得た「100」を「0から」の発話で使えた瞬間の記録。
 */
export async function markPhraseUsed(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from('phrases')
    .select('used_count, graduated_at')
    .eq('id', id)
    .single();

  if (readError) return { ok: false, error: readError.message };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('phrases')
    .update({
      used_count: current.used_count + 1,
      last_used_at: now,
      // 初回使用でその瞬間に「身についた」へ卒業。以降は据え置き。
      graduated_at: current.graduated_at ?? now,
    })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/phrases');
  revalidatePath('/monologue');
  return { ok: true, data: undefined };
}

export async function deletePhrase(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();
  const { error } = await supabase.from('phrases').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/phrases');
  return { ok: true, data: undefined };
}
