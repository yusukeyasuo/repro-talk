'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { RecordingKind } from '@/types/database';

/**
 * 音声そのものは Storage にクライアントから直接アップロードする（Blob をサーバに通さない）。
 * ここではメタデータ行だけを作る。
 */
export async function saveRecording(input: {
  kind: RecordingKind;
  storagePath: string;
  mimeType: string;
  durationSec: number;
  clipId?: string | null;
  monologueSessionId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  // 他人のフォルダを指す path を弾く
  if (!input.storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: '不正な保存先です' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('recordings')
    .insert({
      user_id: user.id,
      kind: input.kind,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      duration_sec: Math.max(0, Math.round(input.durationSec)),
      clip_id: input.clipId ?? null,
      monologue_session_id: input.monologueSessionId ?? null,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  return { ok: true, data: { id: data.id } };
}
