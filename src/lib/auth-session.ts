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

/**
 * クッキーから読んだセッションのうち、判定に使う部分。
 * ここで読むのは「どれくらい持つか」を見るためだけで、検証は Supabase に任せる。
 */
export type StoredSession = {
  access_token: string;
  refresh_token: string;
  /** access token の期限（UNIX 秒） */
  expires_at: number;
};

/**
 * Route Handler（/api/*）で更新（refresh）をかけずに済む、access token の残り時間の下限。
 *
 * /api の AI 呼び出しは最大 300 秒かかる。Route Handler の中でトークンを回転させると、
 * 新しいトークンは**レスポンスが返るまで**ブラウザに届かない。その間に古い refresh token で
 * 別のリクエストが飛ぶと、Supabase は「使い回し」とみなしてセッションごと失効させる
 * （= ログアウト）。中断・圏外・タイムアウトでレスポンスが届かなくても同じことになる。
 * だから /api ではトークンを回転させず、残りが短いときは「更新して出直して」と返す。
 * 最長の maxDuration（300 秒）より長く取り、処理中に期限が切れないようにする。
 */
export const API_MIN_REMAINING_SEC = 10 * 60;

/**
 * proxy がクッキーを打ち直してよい、access token の残り時間の下限。
 *
 * 打ち直すのはリクエストに載ってきた値なので、処理中に別のリクエストがトークンを
 * 回転させていると、古い値で新しい値を上書きしてしまう（その古い refresh token は
 * 次に使われた瞬間にセッションごと失効する）。回転が起きるのは残りが
 * API_MIN_REMAINING_SEC を切ってからなので、それより十分長いときだけ打ち直す。
 */
export const KEEP_COOKIE_MIN_REMAINING_SEC = 15 * 60;

/** /api が「トークンを更新してから出直して」と返すときのヘッダ。`apiFetch()` が見る。 */
export const SESSION_REFRESH_HEADER = 'x-session-refresh';

/** Supabase の認証クッキー名（分割前のキー）。`supabase-js` の既定と同じ作り方。 */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

const BASE64_PREFIX = 'base64-';

/**
 * 認証クッキーの中身を読む。`@supabase/ssr` は `key` か、長いと `key.0` `key.1` … に分けて、
 * `base64-` + base64url(JSON) で書く。読めなければ null。
 */
export function readStoredSession(
  key: string,
  cookies: { name: string; value: string }[],
): StoredSession | null {
  const byName = new Map(cookies.map((c) => [c.name, c.value]));
  let raw = byName.get(key);
  if (raw === undefined) {
    const parts: string[] = [];
    for (let i = 0; byName.has(`${key}.${i}`); i++) parts.push(byName.get(`${key}.${i}`)!);
    if (parts.length === 0) return null;
    raw = parts.join('');
  }

  try {
    const json = raw.startsWith(BASE64_PREFIX)
      ? new TextDecoder().decode(base64UrlToBytes(raw.slice(BASE64_PREFIX.length)))
      : raw;
    const parsed = JSON.parse(json) as Partial<StoredSession> | null;
    if (
      !parsed ||
      typeof parsed.access_token !== 'string' ||
      typeof parsed.refresh_token !== 'string' ||
      typeof parsed.expires_at !== 'number'
    ) {
      return null;
    }
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: parsed.expires_at,
    };
  } catch {
    return null;
  }
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/** access token の残り秒数。 */
export function remainingSec(session: StoredSession, nowMs: number): number {
  return session.expires_at - nowMs / 1000;
}
