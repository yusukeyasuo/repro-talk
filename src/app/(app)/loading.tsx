import { Skeleton } from '@/components/ui/skeleton';

/**
 * ページ遷移中の骨組み。(app) 配下は全ページ force-dynamic で Supabase を叩くので、
 * これが無いとタップしてから中身が届くまで画面が前のページのまま固まって見える
 * （特にスマホの回線だと「押せていないのでは」と迷う）。個別の loading.tsx を
 * 置いていないページはすべてこれが出る。
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">読み込み中</span>

      <header className="flex items-start justify-between gap-3">
        <div className="w-full max-w-md space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-9 w-28 shrink-0" />
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border p-5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
