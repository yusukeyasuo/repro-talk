import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canSubmitAttempt, ratingMeta } from '../src/lib/composition-judge.ts';

describe('composition-judge: 判定バッジのメタ情報', () => {
  it('great / good / bad はそれぞれのラベルを返す', () => {
    assert.equal(ratingMeta('great').label, 'Great（自然）');
    assert.equal(ratingMeta('good').label, 'Good（通じる）');
    assert.equal(ratingMeta('bad').label, 'Bad（通じない）');
  });

  it('想定外の値は good にフォールバックする（空バッジを描かない）', () => {
    assert.equal(ratingMeta('weird').label, ratingMeta('good').label);
    assert.equal(ratingMeta('weird').badgeClass, ratingMeta('good').badgeClass);
    assert.equal(ratingMeta('').label, ratingMeta('good').label);
  });
});

describe('composition-judge: 送信できるか', () => {
  it('空・空白だけは送れない', () => {
    assert.equal(canSubmitAttempt(''), false);
    assert.equal(canSubmitAttempt('   '), false);
  });

  it('中身があれば送れる', () => {
    assert.equal(canSubmitAttempt('hi'), true);
  });
});
