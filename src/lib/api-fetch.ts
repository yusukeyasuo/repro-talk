import { SESSION_REFRESH_HEADER } from '@/lib/auth-session';

let refreshing: Promise<boolean> | null = null;

/**
 * access token を、/api の長い処理に耐える長さまで更新する（足りていれば何もしない）。
 * 同時に何本呼ばれても、更新のリクエストは1本にまとめる（同じ refresh token を
 * 並行して使わない）。
 */
export function ensureFreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * /api を呼ぶときの fetch。トークンの更新が要ると言われたら、短いリクエストで
 * 更新してから1回だけ出直す。/api 側ではトークンを回転させない（`getApiAuth()`）。
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401 || res.headers.get(SESSION_REFRESH_HEADER) !== '1') return res;
  if (!(await ensureFreshSession())) return res;
  return fetch(input, init);
}
