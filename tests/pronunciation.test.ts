import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveAiPronunciations,
  reanchorPronunciations,
} from '../src/lib/pronunciation-anchor.ts';
import {
  normalizePronunciations,
  tokenizeWords,
  type Pronunciation,
} from '../src/types/pronunciation.ts';

describe('tokenizeWords', () => {
  it('語の [start, end) を返す', () => {
    const tokens = tokenizeWords('Today I want to figure out.');
    assert.deepEqual(
      tokens.map((t) => t.word),
      ['Today', 'I', 'want', 'to', 'figure', 'out'],
    );
    assert.equal(tokens[0]?.start, 0);
    assert.equal(tokens[0]?.end, 5);
    // 末尾のピリオドは語に含めない
    assert.equal(tokens[5]?.end, 26);
  });

  it('語中のアポストロフィ・ハイフンは語の一部として扱う', () => {
    const tokens = tokenizeWords("we shouldn't use short-term plans");
    assert.deepEqual(
      tokens.map((t) => t.word),
      ['we', "shouldn't", 'use', 'short-term', 'plans'],
    );
  });

  it('数字だけのかたまりは語にしない', () => {
    assert.deepEqual(
      tokenizeWords('30 seconds').map((t) => t.word),
      ['seconds'],
    );
  });
});

describe('pronunciation-anchor: AI の語ごとの読みをオフセットに解決する', () => {
  const transcript = 'Today I want to figure out how big this project should be.';

  it('出現順に突き合わせて [start, end) を復元する', () => {
    const result = resolveAiPronunciations(
      [
        { word: 'Today', ipa: 'təˈdeɪ' },
        { word: 'I', ipa: 'aɪ' },
        { word: 'want', ipa: 'wɑnt' },
      ],
      transcript,
    );

    assert.equal(result.length, 3);
    assert.deepEqual(result[0], { start: 0, end: 5, ipa: 'təˈdeɪ' });
    assert.equal(transcript.slice(result[2]!.start, result[2]!.end), 'want');
  });

  it('同じ語が複数あっても出現順に別々の位置へ割り当てる', () => {
    const text = 'I want to want it.';
    const result = resolveAiPronunciations(
      [
        { word: 'want', ipa: 'wɑnt' },
        { word: 'want', ipa: 'wɑnt' },
      ],
      text,
    );

    assert.equal(result.length, 2);
    assert.equal(result[0]?.start, 2);
    assert.equal(result[1]?.start, 10);
  });

  it('大文字小文字・前後の記号が違っても拾う', () => {
    const result = resolveAiPronunciations([{ word: 'today,' as string, ipa: 'təˈdeɪ' }], transcript);
    assert.deepEqual(result[0], { start: 0, end: 5, ipa: 'təˈdeɪ' });
  });

  it('スクリプトに無い語は捨て、後ろの語で並びに復帰する', () => {
    const result = resolveAiPronunciations(
      [
        { word: 'Today', ipa: 'təˈdeɪ' },
        { word: 'tomorrow', ipa: 'təˈmɑroʊ' }, // 原文に無い
        { word: 'figure', ipa: 'ˈfɪɡjər' },
      ],
      transcript,
    );

    assert.equal(result.length, 2);
    assert.equal(transcript.slice(result[1]!.start, result[1]!.end), 'figure');
  });

  it('読みが空の項目は捨てる', () => {
    const result = resolveAiPronunciations(
      [
        { word: 'Today', ipa: '  ' },
        { word: 'I', ipa: 'aɪ' },
      ],
      transcript,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.ipa, 'aɪ');
  });

  it('配列でない入力は空になる', () => {
    assert.deepEqual(resolveAiPronunciations(null, transcript), []);
    assert.deepEqual(resolveAiPronunciations({ words: [] }, transcript), []);
  });
});

describe('normalizePronunciations', () => {
  it('範囲外・空範囲・読みなしを落とす', () => {
    const result = normalizePronunciations(
      [
        { start: 0, end: 5, ipa: 'təˈdeɪ' },
        { start: 5, end: 5, ipa: 'x' }, // 空範囲
        { start: 3, end: 1, ipa: 'x' }, // 逆転
        { start: 0, end: 5 }, // 読みなし
        'not an object',
      ],
      10,
    );
    assert.equal(result.length, 1);
  });

  it('テキスト長で丸める', () => {
    const result = normalizePronunciations([{ start: 0, end: 99, ipa: 'aɪ' }], 4);
    assert.deepEqual(result[0], { start: 0, end: 4, ipa: 'aɪ' });
  });

  it('同じ位置に2つ来たら1つにする（行が二重にならないように）', () => {
    const result = normalizePronunciations(
      [
        { start: 0, end: 5, ipa: 'təˈdeɪ' },
        { start: 0, end: 5, ipa: 'tuˈdeɪ' },
      ],
      20,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.ipa, 'təˈdeɪ');
  });
});

describe('reanchorPronunciations: 本文を編集したときの貼り直し', () => {
  const oldText = 'Today I want to figure out how big this project should be.';

  it('残っている語は新しい位置へ移す', () => {
    const newText = 'Well, today I want to figure out how big this project should be.';
    const before: Pronunciation[] = [
      { start: 16, end: 22, ipa: 'ˈfɪɡjər' }, // figure
    ];
    assert.equal(oldText.slice(16, 22), 'figure');

    const after = reanchorPronunciations(before, oldText, newText);
    assert.equal(after.length, 1);
    assert.equal(newText.slice(after[0]!.start, after[0]!.end), 'figure');
  });

  it('消えた語は落とす', () => {
    const newText = 'Today I want to know how big this project should be.';
    const before: Pronunciation[] = [{ start: 16, end: 22, ipa: 'ˈfɪɡjər' }];

    assert.deepEqual(reanchorPronunciations(before, oldText, newText), []);
  });
});
