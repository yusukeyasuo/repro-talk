import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Workspace } from '@/components/workspace/workspace';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { Clip, Material } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data: clip } = await supabase.from('clips').select('*').eq('id', id).maybeSingle();
  if (!clip) notFound();

  const typedClip = clip as Clip;
  const { data: material } = await supabase
    .from('materials')
    .select('*')
    .eq('id', typedClip.material_id)
    .maybeSingle();

  if (!material) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/materials/${typedClip.material_id}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← {(material as Material).title}
        </Link>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {typedClip.label || 'リプロダクション'}
        </h1>
      </header>

      <Workspace clip={typedClip} material={material as Material} userId={user.id} />
    </div>
  );
}
