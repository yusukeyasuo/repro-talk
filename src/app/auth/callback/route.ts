import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/** 失敗したらログイン画面へ理由つきで戻す。無言で戻すと原因が分からず送り直しになる。 */
function backToLogin(origin: string, reason: 'verify' | 'expired' | 'link') {
  return NextResponse.redirect(`${origin}/login?error=${reason}`);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get('next') ?? '/';

  // Supabase 側で弾かれた場合は、コードではなくエラーがクエリに載って戻ってくる。
  const errorCode = searchParams.get('error_code') ?? searchParams.get('error');
  if (errorCode) {
    return backToLogin(origin, errorCode.includes('expired') ? 'expired' : 'link');
  }

  const code = searchParams.get('code');
  if (!code) return backToLogin(origin, 'link');

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // code-verifier はリンクを要求したブラウザのクッキーにある。無いなら別のブラウザで開いている。
    const reason = error.name === 'AuthPKCECodeVerifierMissingError' ? 'verify' : 'expired';
    return backToLogin(origin, reason);
  }

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(`${origin}${safeNext}`);
}
