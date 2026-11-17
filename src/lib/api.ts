import { NextResponse } from 'next/server';

import { AiParseError, AiRefusalError, AiTruncatedError } from './ai/run';
import { SESSION_REFRESH_HEADER } from './auth-session';

/** middleware は /api/ を除外しているので、各 Route Handler が自分で認証する。 */
export function unauthorized() {
  return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
}

/** access token の残りが短い。`/api/auth/refresh` で更新してから出直してほしい。 */
export function sessionRefreshRequired() {
  return NextResponse.json(
    { error: 'ログインの更新が必要です。もう一度試してください' },
    { status: 401, headers: { [SESSION_REFRESH_HEADER]: '1' } },
  );
}

/** Supabase に確認できなかった（圏外・一時障害）。ログアウトはしていない。 */
export function unverified() {
  return NextResponse.json(
    { error: '接続を確認できませんでした。ログアウトはしていません。少し待ってもう一度試してください' },
    { status: 503 },
  );
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiRefusalError) {
    return NextResponse.json(
      {
        error:
          'AI がこの内容への応答を控えました。表現を変えてもう一度試してください。',
        category: error.category,
      },
      { status: 422 },
    );
  }
  if (error instanceof AiTruncatedError) {
    return NextResponse.json(
      { error: 'AI の出力が途中で切れました。もう一度試してください。' },
      { status: 502 },
    );
  }
  if (error instanceof AiParseError) {
    return NextResponse.json(
      { error: 'AI の出力を読み取れませんでした。もう一度試してください。' },
      { status: 502 },
    );
  }

  console.error('[ai]', error);
  const message = error instanceof Error ? error.message : 'AI の呼び出しに失敗しました';
  return NextResponse.json({ error: message }, { status: 500 });
}
