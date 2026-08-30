import { redirect } from 'next/navigation';

import { BottomNav, TopNav } from '@/components/layout/nav';
import { StudyBar } from '@/components/study/study-bar';
import { getRunningStudySession } from '@/lib/study-server';
import { getCurrentUser } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

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
