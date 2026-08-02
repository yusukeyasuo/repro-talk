import { redirect } from 'next/navigation';

import { BottomNav, TopNav } from '@/components/layout/nav';
import { getCurrentUser } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
        {children}
      </main>
      <BottomNav />
    </>
  );
}
