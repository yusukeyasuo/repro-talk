import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isAuthCookieName, judgeAuth } from '../src/lib/auth-session.ts';

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
