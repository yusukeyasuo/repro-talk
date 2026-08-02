import Image from 'next/image';
import Link from 'next/link';

import { AddMaterialDialog } from '@/components/material/add-material-dialog';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/server';
import { MATERIAL_LEVELS, type Material } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MaterialsPage() {
  const supabase = await createClient();
  const [{ data }, { data: clipRows }] = await Promise.all([
    supabase
      .from('materials')
      .select('*')
      .order('level')
      .order('created_at', { ascending: false }),
    supabase.from('clips').select('material_id'),
  ]);

  const materials = (data ?? []) as Material[];
  const clipCounts = new Map<string, number>();
  for (const row of clipRows ?? []) {
    clipCounts.set(row.material_id, (clipCounts.get(row.material_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">素材</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ネイティブの生の英語を「100のまま」受け取るための素材。1本から30秒の区間を切り出して使います。
          </p>
        </div>
        <AddMaterialDialog />
      </header>

      {materials.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            まだ素材がありません。まずは1本、YouTube の URL を登録してみてください。
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
                  <li key={material.id}>
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
    </div>
  );
}
