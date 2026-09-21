import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { judgeAuth } from '@/lib/auth-session';
import type { Database } from '@/types/database';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component から呼ばれた場合は書き込めない。middleware が更新するので無視。
          }
        },
      },
    },
  );
}

/** ログイン必須のページ・API で使う。未ログインなら null を返す。 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export type AuthState =
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }
  | { status: 'unverified' };

/**
 * ログイン画面へ飛ばすかどうかを決める側（レイアウト）のための読み取り。
 *
 * `getCurrentUser()` と違って「確認できなかった」（通信エラー・Supabase の一時障害）を
 * `unverified` として分けて返す。セッションは生きているかもしれないので、追い出さない。
 */
export async function getAuthState(): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const verdict = judgeAuth(Boolean(user), error);
  if (verdict === 'authenticated' && user) return { status: 'authenticated', user };
  return { status: verdict === 'authenticated' ? 'unauthenticated' : verdict };
}
