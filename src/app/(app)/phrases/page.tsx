import { PhraseList } from '@/components/monologue/phrase-list';
import { createClient } from '@/lib/supabase/server';
import type { Phrase } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function PhrasesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('phrases')
    .select('*')
    .order('created_at', { ascending: false });

  const phrases = (data ?? []) as Phrase[];
  const inStock = phrases.filter((p) => p.graduated_at === null);
  const graduated = phrases.filter((p) => p.graduated_at !== null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">フレーズ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          リプロダクションで「100のまま」入れた表現。独り言で一度使えたら「身についた」に移ります。
        </p>
        {phrases.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            在庫 {inStock.length} 件 / 身についた {graduated.length} 件
          </p>
        )}
      </header>

      {phrases.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            まだありません。クリップの「独り言で使えるフレーズを抽出」から追加できます。
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-sm font-medium">在庫（まだ口から出していない）</h2>
            {inStock.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                在庫は空です。次のクリップからフレーズを抜きましょう。
              </p>
            ) : (
              <PhraseList phrases={inStock} />
            )}
          </section>

          {graduated.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium">身についた</h2>
              <PhraseList phrases={graduated} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
