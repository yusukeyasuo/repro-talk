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
    // まだ卒業していない在庫だけを、新しく入れた順に出す（温かいうちに口から出す）。
    // 一度でも使えたフレーズは graduated_at が入り、ここには出てこない。
    supabase
      .from('phrases')
      .select('*')
      .is('graduated_at', null)
      .order('created_at', { ascending: false })
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
        goalSec={(profile as Profile | null)?.daily_goal_sec ?? 60}
      />
    </div>
  );
}
