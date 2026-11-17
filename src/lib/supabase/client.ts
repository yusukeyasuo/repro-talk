import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/types/database';

/**
 * ブラウザ側のクライアント。トークンの自動更新は切る。
 *
 * 回転（refresh）はサーバ（proxy と `/api/auth/refresh`）だけで行う。ブラウザが裏で回転させると、
 * 同時に飛んでいるリクエストのレスポンスが古いトークンで上書きしたり（proxy の打ち直し）、
 * サーバ側と同じ refresh token を取り合ったりして、Supabase に使い回しとみなされ
 * セッションごと失効する。ブラウザが書くクッキーは Safari の7日上限の対象でもある。
 * Storage に直接上げる前は `ensureFreshSession()` を呼んでおく。
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false } },
  );
}
