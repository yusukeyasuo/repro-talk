import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClipCreator } from '@/components/material/clip-creator';
import { DeleteClipButton } from '@/components/material/delete-clip-button';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/server';
import { formatSeconds, watchUrl } from '@/lib/youtube';
import { MATERIAL_LEVELS, type Clip, type Material } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: material }, { data: clips }] = await Promise.all([
    supabase.from('materials').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('clips')
      .select('*')
      .eq('material_id', id)
      .order('start_sec', { ascending: true }),
  ]);

  if (!material) notFound();

  const typedMaterial = material as Material;
  const typedClips = (clips ?? []) as Clip[];
  const levelMeta = MATERIAL_LEVELS.find((l) => l.level === typedMaterial.level);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link href="/materials" className="text-xs text-muted-foreground hover:underline">
          ← 素材一覧
        </Link>
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {typedMaterial.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{typedMaterial.channel_name}</span>
          {levelMeta && <Badge variant="secondary">{levelMeta.label}</Badge>}
          <a
            href={watchUrl(typedMaterial.youtube_video_id)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:underline"
          >
            YouTube で開く
            <ExternalLink className="size-3" />
          </a>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">練習する区間を切り出す</h2>
            <p className="text-xs text-muted-foreground">
              「この部分かっこいい、こう喋れるようになりたい」と思う30秒を選びます。
            </p>
          </div>
          <ClipCreator
            materialId={typedMaterial.id}
            videoId={typedMaterial.youtube_video_id}
          />
        </div>

        <aside className="space-y-3">
          <h2 className="text-sm font-medium">クリップ（{typedClips.length}）</h2>
          {typedClips.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              まだありません。左で開始と終了を打ってクリップを作ってください。
            </p>
          ) : (
            <ul className="space-y-2">
              {typedClips.map((clip) => (
                <li key={clip.id} className="flex items-stretch gap-1">
                  <Link
                    href={`/clips/${clip.id}`}
                    className="min-w-0 flex-1 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {formatSeconds(clip.start_sec)} – {formatSeconds(clip.end_sec)}
                      </span>
                      {clip.transcript ? (
                        <Badge variant="secondary" className="ml-auto">
                          {clip.annotations.length} 記号
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="ml-auto">
                          未着手
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">
                      {clip.label || clip.transcript || 'スクリプト未入力'}
                    </p>
                  </Link>
                  <DeleteClipButton
                    id={clip.id}
                    materialId={typedMaterial.id}
                    label={
                      clip.label ||
                      `${formatSeconds(clip.start_sec)}–${formatSeconds(clip.end_sec)}`
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </aside>
      </section>
    </div>
  );
}
