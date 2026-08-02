'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

export async function updateProfile(input: {
  displayName?: string | null;
  /** 「英語の先に理解したい何か」。継続の芯なので常時表示する。 */
  whyText?: string | null;
  dailyGoalSec?: number;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const patch: Partial<Profile> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.whyText !== undefined) patch.why_text = input.whyText;
  if (input.dailyGoalSec !== undefined) {
    patch.daily_goal_sec = Math.max(30, Math.round(input.dailyGoalSec));
  }
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  // profiles 行は auth トリガで作られるが、念のため upsert にする
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...patch }, { onConflict: 'id' });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  revalidatePath('/settings');
  return { ok: true, data: undefined };
}

export async function signOut(): Promise<ActionResult> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return { ok: true, data: undefined };
}
