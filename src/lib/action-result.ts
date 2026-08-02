/**
 * Server Action の戻り値。
 * 'use server' なファイルは async 関数しか export できないので型は別モジュールに置く。
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const AUTH_REQUIRED = { ok: false, error: 'ログインが必要です' } as const;
