'use client';

import { BookOpen, Home, Library, Mic, Quote, Settings, Zap, type LucideIcon } from 'lucide-react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', label: 'ホーム', icon: Home, exact: true },
  { href: '/materials', label: '素材', icon: Library, exact: false },
  { href: '/monologue', label: '独り言', icon: Mic, exact: false },
  { href: '/compositions', label: '英作文', icon: Zap, exact: false },
  { href: '/phrases', label: 'フレーズ', icon: Quote, exact: false },
  { href: '/guide', label: '使い方', icon: BookOpen, exact: false },
  { href: '/settings', label: '設定', icon: Settings, exact: false },
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
          {ITEMS.map(({ href, label, icon: Icon, exact }) => (
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

export function BottomNav() {
  const isActive = useActive();

  return (
    <nav className="sticky bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-7">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => (
          <li key={href}>
            <Link
              href={href}
              className={cn(
                'flex flex-col items-center gap-1 py-2 text-[10px] transition-colors',
                isActive(href, exact) ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <NavIcon icon={Icon} className="size-5" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
