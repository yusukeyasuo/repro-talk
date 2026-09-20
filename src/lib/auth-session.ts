/**
 * ログイン状態の判定まわりの純粋ロジック。
 *
 * ねらいは「セッションが切れた」と「いま確かめられなかった」を分けること。
 * `supabase.auth.getUser()` は Supabase への HTTP リクエストなので、電波が切れただけでも
 * user は null になる。それをログアウト扱いにすると、外を歩きながら使っているときに
 * ログイン画面へ飛ばされ、メール再送（内蔵メールは1時間に2通）まで巻き込む。
 */

/**
 * 認証クッキーを打ち直すときの寿命。`@supabase/ssr` の既定（400日）に合わせる。
 * 毎リクエスト打ち直すので、使っているかぎり期限は先へ転がり続ける。
 */
export const AUTH_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

export type AuthVerdict = 'authenticated' | 'unauthenticated' | 'unverified';

/** `AuthError` のうち判定に使う部分だけ。テストのためにインターフェースを絞る。 */
export type AuthErrorLike = { name?: string; status?: number } | null | undefined;

/**
 * user と error から3値を出す。
 *
 * `unverified` は「まだログインしているかもしれないが確認できなかった」。
 * 呼び出し側はログイン画面へ飛ばさず、クッキーもそのまま残す。
 */
export function judgeAuth(hasUser: boolean, error: AuthErrorLike): AuthVerdict {
  if (hasUser) return 'authenticated';
  if (!error) return 'unauthenticated';
  if (error.name === 'AuthRetryableFetchError') return 'unverified';

  // status が無いのは fetch 自体が飛ばなかったとき（圏外・DNS・タイムアウト）。
  if (error.status === undefined) return 'unverified';
  // 429 は「上限に当たった」、5xx は Supabase 側の一時障害。どちらもこちらの落ち度ではない。
  if (error.status === 429 || error.status >= 500) return 'unverified';

  return 'unauthenticated';
}

/**
 * Supabase の認証クッキーか。名前は `sb-<project-ref>-auth-token` で、
 * 長いと `.0` `.1` に分割される。
 *
 * PKCE の code-verifier（`...-auth-token-code-verifier`）は1回のログインで使い切る
 * 短命なものなので、延命の対象から外す。
 */
export function isAuthCookieName(name: string): boolean {
  if (!name.startsWith('sb-')) return false;
  return /-auth-token(\.\d+)?$/.test(name);
}
