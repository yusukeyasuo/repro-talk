import Image from 'next/image';
import Link from 'next/link';

import { AddMaterialDialog } from '@/components/material/add-material-dialog';
import { AddTextClipDialog } from '@/components/material/add-text-clip-dialog';
import { DeleteClipButton } from '@/components/material/delete-clip-button';
import { DeleteMaterialButton } from '@/components/material/delete-material-button';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/server';
import { MATERIAL_LEVELS, type Clip, type Material } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MaterialsPage() {
  const supabase = await createClient();
  const [{ data }, { data: clipRows }, { data: textRows }] = await Promise.all([
    supabase
      .from('materials')
      .select('*')
      .order('level')
      .order('created_at', { ascending: false }),
    // 動画クリップの本数（材料カードのバッジ用）。text クリップは material を持たないので除く。
    supabase.from('clips').select('material_id').eq('source', 'youtube'),
    // 自作テキスト（材料を持たないクリップ）
    supabase
      .from('clips')
      .select('*')
      .eq('source', 'text')
      .order('created_at', { ascending: false }),
  ]);

  const materials = (data ?? []) as Material[];
  const textClips = (textRows ?? []) as Clip[];
  const clipCounts = new Map<string, number>();
  for (const row of clipRows ?? []) {
    if (row.material_id) {
      clipCounts.set(row.material_id, (clipCounts.get(row.material_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">素材</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ネイティブの生の英語を「100のまま」受け取るための素材。動画は30秒の区間を切り出して、自作テキストはそのまま使います。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AddTextClipDialog />
          <AddMaterialDialog />
        </div>
      </header>

      {materials.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            まだ動画素材がありません。まずは1本、YouTube の URL を登録してみてください。
          </p>
        </div>
      ) : (
        MATERIAL_LEVELS.map((levelMeta) => {
          const items = materials.filter((m) => m.level === levelMeta.level);
          if (items.length === 0) return null;

          return (
            <section key={levelMeta.level} className="space-y-3">
              <div>
                <h2 className="text-sm font-medium">{levelMeta.label}</h2>
                <p className="text-xs text-muted-foreground">{levelMeta.hint}</p>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((material) => (
                  <li key={material.id} className="relative">
                    <div className="absolute right-2 top-2 z-10">
                      <DeleteMaterialButton
                        id={material.id}
                        title={material.title}
                        clipCount={clipCounts.get(material.id) ?? 0}
                      />
                    </div>
                    <Link
                      href={`/materials/${material.id}`}
                      className="group block overflow-hidden rounded-lg border transition-colors hover:bg-accent/40"
                    >
                      <div className="relative aspect-video bg-muted">
                        {material.thumbnail_url && (
                          <Image
                            src={material.thumbnail_url}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 100vw, 33vw"
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div className="space-y-1 p-3">
                        <p className="line-clamp-2 text-sm font-medium">{material.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{material.channel_name}</span>
                          <Badge variant="secondary" className="ml-auto shrink-0">
                            {clipCounts.get(material.id) ?? 0} クリップ
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">自作テキスト</h2>
          <p className="text-xs text-muted-foreground">
            自分で登録した英文。クラウド音声で読み上げ、1文ずつ止めて再現します。
          </p>
        </div>

        {textClips.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              まだ自作テキストがありません。「テキストを登録」から追加できます。
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {textClips.map((clip) => (
              <li key={clip.id} className="relative">
                <div className="absolute right-2 top-2 z-10">
                  <DeleteClipButton id={clip.id} label={clip.label || 'テキスト'} />
                </div>
                <Link
                  href={`/clips/${clip.id}`}
                  className="group block h-full overflow-hidden rounded-lg border p-3 transition-colors hover:bg-accent/40"
                >
                  <p className="pr-6 text-sm font-medium">{clip.label || '無題のテキスト'}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                    {clip.transcript || '（本文なし）'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
