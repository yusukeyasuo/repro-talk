import { NextResponse } from 'next/server';

import { unauthorized, unverified } from '@/lib/api';
import { API_MIN_REMAINING_SEC, judgeAuth } from '@/lib/auth-session';
import { createClient } from '@/lib/supabase/server';

/**
 * /api を呼ぶ前に、access token を「数分の処理に耐える」長さまで更新する。
 *
 * トークンの回転はこの短いリクエストの中だけで済ませ、新しいクッキーをすぐ返す。
 * 長い AI 呼び出しの中で回転させると、新しいトークンが届く前に古い refresh token が
 * 使われてセッションごと失効する（`getApiAuth()` の説明を参照）。
 * 十分に残っていれば何もしない（無駄に回転させない）。
 */
export async function POST() {
  const supabase = await createClient();
  // 期限が目前（90 秒以内）ならここで回転する。
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (!session) {
    return judgeAuth(false, error) === 'unverified' ? unverified() : unauthorized();
  }

  const remaining = (session.expires_at ?? 0) - Date.now() / 1000;
  if (remaining < API_MIN_REMAINING_SEC) {
    const { data, error: refreshError } = await supabase.auth.refreshSession(session);
    if (!data.session) {
      return judgeAuth(false, refreshError) === 'unverified' ? unverified() : unauthorized();
    }
  }

  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
