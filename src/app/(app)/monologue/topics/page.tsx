import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TopicManager } from '@/components/monologue/topic-manager';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { MonologueTopic } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MonologueTopicsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data } = await supabase.from('monologue_topics').select('*').order('sort_order');

  // RLS が返すのは「共通シード or 自分のお題」だけなので、user_id の有無で分けられる。
  const topics = (data ?? []) as MonologueTopic[];

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <Link
          href="/monologue"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          独り言に戻る
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">お題</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          話したいことを自分で足せます。自分の生活・仕事・興味に寄せたお題ほど、口から言葉が出てきます。
        </p>
      </header>

      <TopicManager
        own={topics.filter((topic) => topic.user_id !== null)}
        seeds={topics.filter((topic) => topic.user_id === null)}
      />
    </div>
  );
}
