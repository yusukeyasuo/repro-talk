import { redirect } from 'next/navigation';

import { ConnectionLost } from '@/components/layout/connection-lost';
import { BottomNav, TopNav } from '@/components/layout/nav';
import { StudyBar } from '@/components/study/study-bar';
import { getRunningStudySession } from '@/lib/study-server';
import { getAuthState } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 「未ログイン」だけログイン画面へ。通信が失敗しただけのときは追い出さない（proxy と同じ判定）。
  const auth = await getAuthState();
  if (auth.status === 'unauthenticated') redirect('/login');
  if (auth.status === 'unverified') return <ConnectionLost />;

  // 計測中の1本。どのページにいても終了できるようにレイアウトで持つ。
  const running = await getRunningStudySession();

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
        {children}
      </main>
      {/* 計測中バーとナビはひとつの入れ物で下に貼り付ける（別々に sticky にすると重なる）。
          計測していないときは高さ0の入れ物として残るだけ。 */}
      <div className="sticky bottom-0 z-30">
        <StudyBar session={running} />
        <BottomNav />
      </div>
    </>
  );
}
