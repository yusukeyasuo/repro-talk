import { redirect } from 'next/navigation';

import { MonologueSession } from '@/components/monologue/monologue-session';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { MonologueTopic, Phrase, Profile } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function MonologuePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const [{ data: topics }, { data: phrases }, { data: profile }] = await Promise.all([
    supabase.from('monologue_topics').select('*').order('sort_order'),
    // 未使用・最終使用が古い順。「まだ口から出していない表現」を優先して出す。
    supabase
      .from('phrases')
      .select('*')
      .order('used_count', { ascending: true })
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(3),
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">独り言</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          自力で 0 から英語を作り出す練習。口が開いている時間は全部これに使えます。
        </p>
      </header>

      <MonologueSession
        topics={(topics ?? []) as MonologueTopic[]}
        phrases={(phrases ?? []) as Phrase[]}
        userId={user.id}
        goalSec={(profile as Profile | null)?.daily_goal_sec ?? 60}
      />
    </div>
  );
}
