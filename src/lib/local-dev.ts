/**
 * ローカルの Supabase に繋いでいるかどうかの判定。
 *
 * `supabase start` で立てた環境は SMTP を設定しない限りメールを外に出さず、
 * すべて Mailpit（CLI 既定では 54324 番）に溜める。ログイン画面が
 * 「メールを開いてください」とだけ言うと必ず詰まるので、そこに出し分けるために使う。
 */

/** Mailpit のポート。`supabase/config.toml` の `[inbucket] port` の既定値。 */
const MAILPIT_PORT = 54324;

export function isLocalSupabase(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const { hostname } = new URL(supabaseUrl);
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * ローカル接続なら Mailpit の URL を、そうでなければ null を返す。
 * null を「本物のメールが届く環境」の判定にも使う。
 */
export function localMailboxUrl(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl || !isLocalSupabase(supabaseUrl)) return null;
  const { protocol, hostname } = new URL(supabaseUrl);
  return `${protocol}//${hostname}:${MAILPIT_PORT}`;
}
