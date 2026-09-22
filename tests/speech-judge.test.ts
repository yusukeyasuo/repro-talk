import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canSubmitSpeech,
  MIN_SPEECH_LENGTH,
  ratingMeta,
  summarizeWordUsage,
} from '../src/lib/speech-judge.ts';

describe('speech-judge: 送信できるか', () => {
  it('空・空白だけは送れない', () => {
    assert.equal(canSubmitSpeech(''), false);
    assert.equal(canSubmitSpeech('     '), false);
  });

  it('最低文字数に満たない一言は送れない', () => {
    assert.equal(canSubmitSpeech('Hi.'), false);
  });

  it('前後の空白を除いた長さで判定する', () => {
    const short = ' '.repeat(20) + 'ok' + ' '.repeat(20);
    assert.equal(short.length >= MIN_SPEECH_LENGTH, true);
    assert.equal(canSubmitSpeech(short), false);
  });

  it('十分な長さのスピーチは送れる', () => {
    assert.equal(canSubmitSpeech('Today I want to talk about my morning.'), true);
  });
});

describe('speech-judge: ワードの使用状況の集計', () => {
  it('使えたワードの数と総数を返す', () => {
    const summary = summarizeWordUsage([
      { used: true },
      { used: false },
      { used: true },
    ]);
    assert.deepEqual(summary, { used: 2, total: 3 });
  });

  it('空配列は 0 / 0 を返す', () => {
    assert.deepEqual(summarizeWordUsage([]), { used: 0, total: 0 });
  });
});

describe('speech-judge: 判定バッジのメタ情報（composition-judge から再利用）', () => {
  it('great / good / bad のラベルを返す', () => {
    assert.equal(ratingMeta('great').label, 'Great（自然）');
    assert.equal(ratingMeta('good').label, 'Good（通じる）');
    assert.equal(ratingMeta('bad').label, 'Bad（通じない）');
  });

  it('想定外の値は good にフォールバックする', () => {
    assert.equal(ratingMeta('weird').label, ratingMeta('good').label);
  });
});
