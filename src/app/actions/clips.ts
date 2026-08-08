'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { normalizeAnnotations, type Annotation } from '@/types/annotation';
import type { Clip } from '@/types/database';

export async function createClip(input: {
  materialId: string;
  startSec: number;
  endSec: number;
  label?: string;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  if (!(input.endSec > input.startSec)) {
    return { ok: false, error: '終了位置は開始位置より後にしてください' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clips')
    .insert({
      user_id: user.id,
      material_id: input.materialId,
      start_sec: Math.max(0, Math.round(input.startSec * 100) / 100),
      end_sec: Math.round(input.endSec * 100) / 100,
      label: input.label?.trim() || null,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/materials/${input.materialId}`);
  return { ok: true, data: { id: data.id } };
}

export async function updateClip(input: {
  id: string;
  transcript?: string;
  translationJa?: string | null;
  annotations?: Annotation[];
  memo?: string | null;
  label?: string | null;
  startSec?: number;
  endSec?: number;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();

  const patch: Partial<Clip> = {};
  if (input.transcript !== undefined) patch.transcript = input.transcript;
  if (input.translationJa !== undefined) patch.translation_ja = input.translationJa;
  if (input.memo !== undefined) patch.memo = input.memo;
  if (input.label !== undefined) patch.label = input.label;
  if (input.startSec !== undefined) patch.start_sec = input.startSec;
  if (input.endSec !== undefined) patch.end_sec = input.endSec;

  if (input.annotations !== undefined) {
    // transcript も同時に変わるならその長さで、変わらないなら保存済みの長さで丸める
    let length = input.transcript?.length;
    if (length === undefined) {
      const { data } = await supabase
        .from('clips')
        .select('transcript')
        .eq('id', input.id)
        .single();
      length = data?.transcript.length ?? 0;
    }
    patch.annotations = normalizeAnnotations(input.annotations, length);
  }

  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const { error } = await supabase.from('clips').update(patch).eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/clips/${input.id}`);
  return { ok: true, data: undefined };
}

export async function deleteClip(input: {
  id: string;
  materialId: string;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();

  // recordings 行はカスケードで消えるが、Storage の実ファイルは残るので先に消す
  const { data: recs } = await supabase
    .from('recordings')
    .select('storage_path')
    .eq('clip_id', input.id);
  const paths = (recs ?? []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from('recordings').remove(paths);
  }

  const { error } = await supabase.from('clips').delete().eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/materials/${input.materialId}`);
  revalidatePath('/');
  return { ok: true, data: undefined };
}

/** リプロダクションを1セット終えたときに呼ぶ。「やった回数」の可視化が目的。 */
export async function logPractice(input: {
  clipId: string;
  repCount: number;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;
  if (input.repCount <= 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { error } = await supabase.from('practice_logs').insert({
    user_id: user.id,
    clip_id: input.clipId,
    rep_count: input.repCount,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  revalidatePath(`/clips/${input.clipId}`);
  return { ok: true, data: undefined };
}
