import { createClient as createSupabaseClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { sessionRefreshRequired, unauthorized, unverified } from '@/lib/api';
import {
  API_MIN_REMAINING_SEC,
  authStorageKey,
  judgeAuth,
  readStoredSession,
  remainingSec,
} from '@/lib/auth-session';
import type { Database } from '@/types/database';

export type ApiAuth =
  | { ok: true; user: User; supabase: SupabaseClient<Database> }
  | { ok: false; response: NextResponse };

/**
 * Route Handler（/api/*）の認証。**トークンを回転（refresh）させない。**
 *
 * `@/lib/supabase/server` の `createClient()` は、access token の期限が近いと
 * その場で refresh token を使って回転させる。/api の AI 呼び出しは数分かかるので、
 * 新しいトークンはレスポンスが返るまでブラウザに届かず、その間に古い refresh token で
 * 別のリクエストが飛ぶと Supabase はセッションごと失効させる。中断・圏外・タイムアウトで
 * レスポンスが落ちても同じ。だからここでは今の access token をそのまま検証するだけにし、
 * 残りが短いときは 401 + `x-session-refresh` を返して、短いリクエスト
 * （`/api/auth/refresh`）で更新してから出直してもらう（`apiFetch()` が自動でやる）。
 *
 * 返す `supabase` は、その access token を Authorization に載せた使い捨てのクライアント。
 * DB/Storage を読んでも回転は起きない。
 */
export async function getApiAuth(): Promise<ApiAuth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const cookieStore = await cookies();
  const session = readStoredSession(authStorageKey(url), cookieStore.getAll());
  if (!session) return { ok: false, response: unauthorized() };
  if (remainingSec(session, Date.now()) < API_MIN_REMAINING_SEC) {
    return { ok: false, response: sessionRefreshRequired() };
  }

  const supabase = createSupabaseClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(session.access_token);

  const verdict = judgeAuth(Boolean(user), error);
  if (verdict === 'authenticated' && user) return { ok: true, user, supabase };
  if (verdict === 'unverified') return { ok: false, response: unverified() };
  return { ok: false, response: unauthorized() };
}
