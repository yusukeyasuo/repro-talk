import { PhraseList } from '@/components/monologue/phrase-list';
import { createClient } from '@/lib/supabase/server';
import type { Phrase } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function PhrasesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('phrases')
    .select('*')
    .order('used_count', { ascending: true })
    .order('created_at', { ascending: false });

  const phrases = (data ?? []) as Phrase[];
  const unused = phrases.filter((p) => p.used_count === 0).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">フレーズ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          リプロダクションで「100のまま」入れた表現の在庫。独り言で使えたらカウントが増えます。
        </p>
        {phrases.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            全 {phrases.length} 件 / まだ使っていない {unused} 件
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
        <PhraseList phrases={phrases} />
      )}
    </div>
  );
}
