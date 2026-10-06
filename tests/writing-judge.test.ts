import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isCompleteWritingJudge, type WritingJudgeResult } from '../src/lib/writing-judge.ts';

const complete: WritingJudgeResult = {
  rating: 'good',
  feedback_ja: '言いたいことは伝わっています。時制だけ揃えましょう。',
  corrected: 'Yesterday I went to the park and it was really nice.',
  corrections: [{ before: 'go', after: 'went', note_ja: '昨日の話なので過去形に' }],
  alternatives: [
    { en: 'It was such a nice day.', meaning_ja: 'すごくいい日だった', note_ja: '感想を一言で' },
  ],
};

describe('writing-judge: 検品', () => {
  it('欠けていない結果は通す', () => {
    assert.equal(isCompleteWritingJudge(complete), true);
  });

  it('直すところが無い（corrections が空）のは正常として通す', () => {
    assert.equal(isCompleteWritingJudge({ ...complete, corrections: [] }), true);
  });

  it('書き直しが途中で切れて短いものは弾く', () => {
    assert.equal(isCompleteWritingJudge({ ...complete, corrected: 'x' }), false);
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
