import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCompleteWritingJudge,
  joinCorrected,
  type WritingJudgeResult,
} from '../src/lib/writing-judge.ts';

const complete: WritingJudgeResult = {
  rating: 'good',
  feedback_ja: '言いたいことは伝わっています。時制だけ揃えましょう。',
  corrected_sentences: [
    { en: 'Yesterday I went to the park.', ja: '昨日、公園に行った。' },
    { en: 'It was really nice.', ja: 'すごくよかった。' },
  ],
  corrections: [{ before: 'go', after: 'went', note_ja: '昨日の話なので過去形に' }],
  alternatives: [
    { en: 'It was such a nice day.', meaning_ja: 'すごくいい日だった', note_ja: '感想を一言で' },
  ],
};

describe('writing-judge: 全文の組み立て', () => {
  it('文ごとの英語を空白1つでつなぐ', () => {
    assert.equal(
      joinCorrected(complete.corrected_sentences),
      'Yesterday I went to the park. It was really nice.',
    );
  });

  it('前後の空白と空の文は落とす', () => {
    assert.equal(
      joinCorrected([
        { en: '  Hi there.  ', ja: 'やあ' },
        { en: ' ', ja: '' },
        { en: 'Bye.', ja: 'じゃあね' },
      ]),
      'Hi there. Bye.',
    );
  });
});

describe('writing-judge: 検品', () => {
  it('欠けていない結果は通す', () => {
    assert.equal(isCompleteWritingJudge(complete), true);
  });

  it('直すところが無い（corrections が空）のは正常として通す', () => {
    assert.equal(isCompleteWritingJudge({ ...complete, corrections: [] }), true);
  });

  it('自然にした文章が空、または途中で切れて短いものは弾く', () => {
    assert.equal(isCompleteWritingJudge({ ...complete, corrected_sentences: [] }), false);
    assert.equal(
      isCompleteWritingJudge({ ...complete, corrected_sentences: [{ en: 'x', ja: 'x' }] }),
      false,
    );
  });

  it('日本語訳が欠けた文があれば弾く（瞬間英作文の問題文になるため）', () => {
    assert.equal(
      isCompleteWritingJudge({
        ...complete,
        corrected_sentences: [...complete.corrected_sentences, { en: 'See you.', ja: ' ' }],
      }),
      false,
    );
  });

  it('総評が空のものは弾く', () => {
    assert.equal(isCompleteWritingJudge({ ...complete, feedback_ja: '  ' }), false);
  });

  it('直し・別の言い方に空の英語が混じっていたら弾く', () => {
    assert.equal(
      isCompleteWritingJudge({
        ...complete,
        corrections: [{ before: 'go', after: '', note_ja: '' }],
      }),
      false,
    );
    assert.equal(
      isCompleteWritingJudge({
        ...complete,
        alternatives: [{ en: ' ', meaning_ja: '', note_ja: '' }],
      }),
      false,
    );
  });
});
