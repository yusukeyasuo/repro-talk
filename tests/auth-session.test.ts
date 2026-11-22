import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  API_MIN_REMAINING_SEC,
  KEEP_COOKIE_MIN_REMAINING_SEC,
  authStorageKey,
  isAuthCookieName,
  judgeAuth,
  readStoredSession,
  remainingSec,
} from '../src/lib/auth-session.ts';

describe('judgeAuth', () => {
  it('user がいれば authenticated', () => {
    assert.equal(judgeAuth(true, null), 'authenticated');
  });

  it('user もエラーも無ければ未ログイン', () => {
    assert.equal(judgeAuth(false, null), 'unauthenticated');
  });

  it('トークンが無効なら未ログイン', () => {
    assert.equal(judgeAuth(false, { name: 'AuthApiError', status: 401 }), 'unauthenticated');
    assert.equal(judgeAuth(false, { name: 'AuthSessionMissingError', status: 400 }), 'unauthenticated');
    assert.equal(judgeAuth(false, { name: 'AuthApiError', status: 403 }), 'unauthenticated');
  });

  it('通信できなかっただけなら unverified（ログアウトさせない）', () => {
    assert.equal(judgeAuth(false, { name: 'AuthRetryableFetchError', status: 0 }), 'unverified');
    assert.equal(judgeAuth(false, { name: 'TypeError' }), 'unverified');
    assert.equal(judgeAuth(false, { name: 'AuthApiError', status: 500 }), 'unverified');
    assert.equal(judgeAuth(false, { name: 'AuthApiError', status: 503 }), 'unverified');
    assert.equal(judgeAuth(false, { name: 'AuthApiError', status: 429 }), 'unverified');
  });
});

describe('isAuthCookieName', () => {
  it('分割ぶんも含めて認証クッキーを拾う', () => {
    assert.equal(isAuthCookieName('sb-abcdefgh-auth-token'), true);
    assert.equal(isAuthCookieName('sb-abcdefgh-auth-token.0'), true);
    assert.equal(isAuthCookieName('sb-abcdefgh-auth-token.1'), true);
  });

  it('code-verifier とそれ以外は延命しない', () => {
    assert.equal(isAuthCookieName('sb-abcdefgh-auth-token-code-verifier'), false);
    assert.equal(isAuthCookieName('theme'), false);
    assert.equal(isAuthCookieName('sb-abcdefgh-something'), false);
  });
});

describe('authStorageKey', () => {
  it('supabase-js の既定と同じキー', () => {
    assert.equal(authStorageKey('https://abcdefgh.supabase.co'), 'sb-abcdefgh-auth-token');
    assert.equal(authStorageKey('http://127.0.0.1:54321'), 'sb-127-auth-token');
  });
});

describe('readStoredSession', () => {
  const key = 'sb-abcdefgh-auth-token';
  const session = {
    access_token: 'at-日本語',
    refresh_token: 'rt',
    expires_at: 1_800_000_000,
    user: { id: 'u' },
  };
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const expected = { access_token: 'at-日本語', refresh_token: 'rt', expires_at: 1_800_000_000 };

  it('base64- 形式を読む', () => {
    assert.deepEqual(readStoredSession(key, [{ name: key, value: encoded }]), expected);
  });

  it('分割されたクッキーをつなげて読む', () => {
    const cookies = [
      { name: `${key}.1`, value: encoded.slice(40) },
      { name: `${key}.0`, value: encoded.slice(0, 40) },
    ];
    assert.deepEqual(readStoredSession(key, cookies), expected);
  });

  it('生の JSON も読む', () => {
    assert.deepEqual(readStoredSession(key, [{ name: key, value: JSON.stringify(session) }]), expected);
  });

  it('無い・壊れている・別プロジェクトなら null', () => {
    assert.equal(readStoredSession(key, []), null);
    assert.equal(readStoredSession(key, [{ name: key, value: 'base64-@@@' }]), null);
    assert.equal(readStoredSession(key, [{ name: key, value: '{"access_token":"a"}' }]), null);
    assert.equal(readStoredSession(key, [{ name: 'sb-other-auth-token', value: encoded }]), null);
    assert.equal(readStoredSession(key, [{ name: `${key}-code-verifier`, value: encoded }]), null);
  });
});

describe('remainingSec', () => {
  it('access token の残り秒数', () => {
    const s = { access_token: 'a', refresh_token: 'r', expires_at: 1000 };
    assert.equal(remainingSec(s, 400_000), 600);
  });

  it('打ち直しの下限は、回転が起きうる長さ（/api の下限）より長い', () => {
    assert.ok(KEEP_COOKIE_MIN_REMAINING_SEC > API_MIN_REMAINING_SEC);
    // /api の最長 maxDuration（300 秒）の間に期限が切れない
    assert.ok(API_MIN_REMAINING_SEC > 300);
  });
});
