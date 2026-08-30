import { BookOpen, ChevronRight, ListChecks, Quote } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SettingsForm } from '@/components/layout/settings-form';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

export const dynamic = 'force-dynamic';

// 毎日は開かないページ。下のナビから外した代わりに、ここを常設の入口にする。
const LINKS = [
  {
    href: '/phrases',
    label: 'フレーズ',
    icon: Quote,
    description: '在庫と、身についたもの',
  },
  {
    href: '/monologue/topics',
    label: '独り言のお題',
    icon: ListChecks,
    description: 'お題の追加・編集・並べ替え',
  },
  {
    href: '/guide',
    label: '使い方',
    icon: BookOpen,
    description: '素材選びから記号づけまでの手順',
  },
];

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

      <section className="space-y-3">
        <h2 className="text-sm font-medium">ときどき開くもの</h2>
        <ul className="divide-y overflow-hidden rounded-xl border">
          {LINKS.map(({ href, label, icon: Icon, description }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex min-h-14 touch-manipulation items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{label}</span>
                  <span className="block text-xs text-muted-foreground">{description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <SettingsForm
        whyText={profile?.why_text ?? ''}
        dailyGoalSec={profile?.daily_goal_sec ?? 60}
        weeklyGoalSec={profile?.weekly_goal_sec ?? 0}
      />
    </div>
  );
}
