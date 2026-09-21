import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE_MAX_AGE_SEC, isAuthCookieName, judgeAuth } from '@/lib/auth-session';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  // Supabase 自身が書いた（＝更新・削除した）クッキー。あとで打ち直す対象から外す。
  const written = new Set<string>();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            written.add(name);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  const verdict = judgeAuth(Boolean(user), error);

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === '/login' || pathname.startsWith('/auth/');

  // 追い出すのは「確かに未ログイン」のときだけ。確認できなかった（unverified）は通す。
  if (verdict === 'unauthenticated' && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return carryCookies(supabaseResponse, NextResponse.redirect(url));
  }

  if (verdict === 'authenticated' && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return carryCookies(supabaseResponse, NextResponse.redirect(url));
  }

  keepAuthCookies(request, supabaseResponse, written);
  return supabaseResponse;
}

/**
 * 認証クッキーを毎リクエスト、サーバから打ち直す。
 *
 * `@supabase/ssr` のブラウザ側クライアントはセッションを `document.cookie` で書く。
 * Safari は「Safari を7日使う間そのサイトに触れていない」と JS が書いたストレージを消すので、
 * サーバの Set-Cookie で上書きし続けて寿命（400日）を転がす。
 * Supabase が今まさに更新・削除したクッキー（written）には触らない。
 */
function keepAuthCookies(request: NextRequest, response: NextResponse, written: Set<string>) {
  for (const { name, value } of request.cookies.getAll()) {
    if (written.has(name) || !isAuthCookieName(name)) continue;
    response.cookies.set(name, value, {
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE_SEC,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      // ブラウザ側の Supabase クライアントが document.cookie で読むので httpOnly にはできない。
      httpOnly: false,
    });
  }
}

/**
 * リダイレクトを返すときは新しいレスポンスになるので、
 * Supabase が書いたクッキー（更新されたトークン・ログアウト時の削除）を載せ替える。
 * これを落とすと、無効なトークンが残ったまま毎回ログイン画面へ弾かれ続ける。
 */
function carryCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|api/).*)'],
};
