import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { StudyStarter } from '@/components/study/study-starter';
import { Workspace } from '@/components/workspace/workspace';
import { getRunningStudySession } from '@/lib/study-server';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { Clip, Material } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: clip }, running] = await Promise.all([
    supabase.from('clips').select('*').eq('id', id).maybeSingle(),
    getRunningStudySession(),
  ]);
  if (!clip) notFound();

  const typedClip = clip as Clip;

  // 自作テキストは動画（material）を持たない
  let material: Material | null = null;
  if (typedClip.source !== 'text' && typedClip.material_id) {
    const { data } = await supabase
      .from('materials')
      .select('*')
      .eq('id', typedClip.material_id)
      .maybeSingle();
    if (!data) notFound();
    material = data as Material;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={material ? `/materials/${typedClip.material_id}` : '/materials'}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← {material ? material.title : '素材'}
        </Link>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {typedClip.label || 'リプロダクション'}
        </h1>
      </header>

      <StudyStarter kind="reproduction" running={running} />

      <Workspace
        clip={typedClip}
        material={material ?? undefined}
        userId={user.id}
        running={running}
      />
    </div>
  );
}
