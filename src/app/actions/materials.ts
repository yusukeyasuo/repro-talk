'use server';

import { revalidatePath } from 'next/cache';

import { AUTH_REQUIRED, type ActionResult } from '@/lib/action-result';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { extractVideoId, fetchOEmbed, thumbnailUrl } from '@/lib/youtube';
import type { MaterialLevel } from '@/types/database';

export async function createMaterial(input: {
  url: string;
  level: MaterialLevel;
}): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const videoId = extractVideoId(input.url);
  if (!videoId) {
    return { ok: false, error: 'YouTube の URL を認識できませんでした' };
  }

  const meta = await fetchOEmbed(videoId);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('materials')
    .upsert(
      {
        user_id: user.id,
        youtube_video_id: videoId,
        title: meta?.title ?? `動画 ${videoId}`,
        channel_name: meta?.author_name ?? null,
        level: input.level,
        thumbnail_url: meta?.thumbnail_url ?? thumbnailUrl(videoId),
      },
      { onConflict: 'user_id,youtube_video_id' },
    )
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath('/materials');
  return { ok: true, data: { id: data.id } };
}

export async function deleteMaterial(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return AUTH_REQUIRED;

  const supabase = await createClient();

  // 素材を消すとクリップ→録音メタはカスケードで消えるが、Storage の実ファイルは残る。
  // 配下クリップの録音を先に集めて Storage から消す（ベストエフォート）。
  const { data: clips } = await supabase
    .from('clips')
    .select('id')
    .eq('material_id', id);
  const clipIds = (clips ?? []).map((c) => c.id);
  if (clipIds.length > 0) {
    const { data: recs } = await supabase
      .from('recordings')
      .select('storage_path')
      .in('clip_id', clipIds);
    const paths = (recs ?? []).map((r) => r.storage_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from('recordings').remove(paths);
    }
  }

  const { error } = await supabase.from('materials').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/materials');
  revalidatePath('/');
  return { ok: true, data: undefined };
}
