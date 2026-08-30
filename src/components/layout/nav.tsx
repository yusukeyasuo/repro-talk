'use client';

import { BookOpen, Home, Library, Mic, Quote, Settings, Zap, type LucideIcon } from 'lucide-react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; icon: LucideIcon; exact: boolean };

/**
 * 毎日通る導線。画面下のナビはこの5つだけに絞る（7つ並べると1マスが指より狭くなる）。
 */
const PRIMARY: Item[] = [
  { href: '/', label: 'ホーム', icon: Home, exact: true },
  { href: '/materials', label: '素材', icon: Library, exact: false },
  { href: '/monologue', label: '独り言', icon: Mic, exact: false },
  { href: '/compositions', label: '英作文', icon: Zap, exact: false },
  { href: '/settings', label: '設定', icon: Settings, exact: false },
];

/**
 * 毎日は開かないもの。横幅のある PC のナビには出すが、スマホでは設定ページから辿る
 * （フレーズは独り言ページの「今日使うフレーズ」からも開ける）。
 */
const SECONDARY: Item[] = [
  { href: '/phrases', label: 'フレーズ', icon: Quote, exact: false },
  { href: '/guide', label: '使い方', icon: BookOpen, exact: false },
];

/**
 * タップした瞬間にアイコンをスピナーへ差し替える。(app) 配下はどれも force-dynamic で
 * サーバの応答を待つため、これが無いとスマホでは「押せたのか」が分からない。
 * `useLinkStatus` は Link の子孫でしか使えないので、専用の子コンポーネントにする。
 */
function NavIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Spinner className={className} aria-label="読み込み中" />
  ) : (
    <Icon className={className} />
  );
}

function useActive() {
  const pathname = usePathname();
  return (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const isActive = useActive();

  return (
    <header className="sticky top-0 z-30 hidden border-b bg-background/80 backdrop-blur md:block">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="font-heading text-base font-semibold tracking-tight">
          repro-talk
        </Link>
        <nav className="flex items-center gap-1">
          {[...PRIMARY, ...SECONDARY].map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive(href, exact)
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <NavIcon icon={Icon} className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

/**
 * 画面下のナビ。sticky はレイアウト側の入れ物（計測中バーと共有する）が持つので、
 * ここでは持たない。2つの要素が別々に bottom-0 で貼り付くと重なってしまう。
 */
export function BottomNav() {
  const isActive = useActive();

  return (
    <nav className="border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {PRIMARY.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 touch-manipulation flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <NavIcon icon={Icon} className="size-6" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
