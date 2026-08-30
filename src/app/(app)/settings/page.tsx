import { redirect } from 'next/navigation';

import { SettingsForm } from '@/components/layout/settings-form';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const profile = data as Profile | null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
      </header>

      <SettingsForm
        whyText={profile?.why_text ?? ''}
        dailyGoalSec={profile?.daily_goal_sec ?? 60}
        weeklyGoalSec={profile?.weekly_goal_sec ?? 0}
      />
    </div>
  );
}
