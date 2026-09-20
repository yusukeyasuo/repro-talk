'use client';

import { RefreshCw, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * ログイン状態を確認できなかったときに出す。
 *
 * ログアウトさせない（セッションは残したまま）のが目的なので、ログイン画面へは誘導しない。
 * 電波が戻ってから読み込み直せば、そのまま続きが使える。
 */
export function ConnectionLost() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WifiOff className="size-5" />
            接続を確認できませんでした
          </CardTitle>
          <CardDescription>
            ログアウトはしていません。電波の届くところで読み込み直してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" />
            読み込み直す
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
