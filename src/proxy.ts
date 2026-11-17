import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import {
  API_MIN_REMAINING_SEC,
  AUTH_COOKIE_MAX_AGE_SEC,
  KEEP_COOKIE_MIN_REMAINING_SEC,
  authStorageKey,
  isAuthCookieName,
  judgeAuth,
  readStoredSession,
  remainingSec,
} from '@/lib/auth-session';

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
  if (verdict === 'authenticated') await refreshEarly(request, supabase);

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
 * 期限が近ければ、ここで（＝短いリクエストの中で）早めに回転させておく。
 *
 * このあと動くサーバコンポーネントもトークンを読むが、そこはクッキーを書けない。
 * 期限が目前（90 秒以内）だとそこで回転が起き、新しいトークンが捨てられて古い refresh token が
 * 残る → 次に使った時点で Supabase がセッションごと失効させる。/api も同じ理由で回転させない
 * （`getApiAuth()`）ので、それより長い余裕をここで作っておく。
 */
async function refreshEarly(request: NextRequest, supabase: ReturnType<typeof createServerClient>) {
  const session = readStoredSession(
    authStorageKey(process.env.NEXT_PUBLIC_SUPABASE_URL!),
    request.cookies.getAll(),
  );
  if (!session || remainingSec(session, Date.now()) >= API_MIN_REMAINING_SEC) return;
  // 失敗しても判定は変えない（通信の切れ目でログアウトさせない）。次のリクエストでまた試す。
  await supabase.auth.refreshSession({ refresh_token: session.refresh_token });
}

/**
 * 認証クッキーを毎リクエスト、サーバから打ち直す。
 *
 * `@supabase/ssr` のブラウザ側クライアントはセッションを `document.cookie` で書く。
 * Safari は「Safari を7日使う間そのサイトに触れていない」と JS が書いたストレージを消すので、
 * サーバの Set-Cookie で上書きし続けて寿命（400日）を転がす。
 * Supabase が今まさに更新・削除したクッキー（written）には触らない。
 *
 * 打ち直すのはリクエストに載ってきた値なので、access token の残りが短いとき（＝どこかで
 * 回転が起きうるとき）は打ち直さない。並行するリクエストが回転させた新しいトークンを、
 * このレスポンスが古い値で上書きすると、古い refresh token が使われた時点で
 * Supabase がセッションごと失効させる（使い回しの検知）。
 */
function keepAuthCookies(request: NextRequest, response: NextResponse, written: Set<string>) {
  const session = readStoredSession(
    authStorageKey(process.env.NEXT_PUBLIC_SUPABASE_URL!),
    request.cookies.getAll(),
  );
  if (!session || remainingSec(session, Date.now()) < KEEP_COOKIE_MIN_REMAINING_SEC) return;

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
