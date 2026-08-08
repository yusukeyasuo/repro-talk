import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveAiAnnotations, reanchorAnnotations } from '../src/lib/annotation-anchor.ts';
import type { Annotation } from '../src/types/annotation.ts';

describe('annotation-anchor: AI の quote をオフセットに解決する', () => {
  const transcript = 'Good morning. I really thought I was gonna say goodbye.';

  it('quote を文字列照合して [start, end) を復元する', () => {
    const result = resolveAiAnnotations(
      [
        { type: 'drop', quote: 'd', occurrence: 1 },
        { type: 'reduction', quote: 'gonna', occurrence: 1, surface: 'gonna' },
      ],
      transcript,
    );

    assert.equal(result.length, 2);
    const drop = result.find((a) => a.type === 'drop');
    assert.ok(drop);
    assert.equal(transcript.slice(drop.start, drop.end), 'd');
    const reduction = result.find((a) => a.type === 'reduction');
    assert.ok(reduction);
    assert.equal(transcript.slice(reduction.start, reduction.end), 'gonna');
    assert.equal(reduction.surface, 'gonna');
  });

  it('occurrence で同じ語の何番目かを選ぶ', () => {
    const result = resolveAiAnnotations([{ type: 'stress', quote: 'I', occurrence: 2 }], transcript);
    assert.equal(result.length, 1);
    const secondI = transcript.indexOf('I', transcript.indexOf('I') + 1);
    assert.equal(result[0].start, secondI);
    assert.equal(transcript.slice(result[0].start, result[0].end), 'I');
  });

  it('occurrence が範囲外なら最初の一致にフォールバックする', () => {
    const result = resolveAiAnnotations([{ type: 'stress', quote: 'I', occurrence: 9 }], transcript);
    assert.equal(result.length, 1);
    assert.equal(result[0].start, transcript.indexOf('I'));
  });

  it('原文に無い quote は落とす', () => {
    const result = resolveAiAnnotations(
      [
        { type: 'stress', quote: 'zzz' },
        { type: 'link', quote: '' },
        { type: 'drop', quote: 'Good' },
      ],
      transcript,
    );
    assert.equal(result.length, 1);
    assert.equal(transcript.slice(result[0].start, result[0].end), 'Good');
  });
});

describe('annotation-anchor: transcript 編集時に注釈を貼り直す', () => {
  const ann = (type: Annotation['type'], start: number, end: number, id = `${type}-${start}`): Annotation => ({
    id,
    type,
    start,
    end,
  });

  it('スパンより後ろの編集では位置が保たれる', () => {
    const oldText = 'Good morning.';
    const newText = 'Good evening now.';
    const { annotations, dropped } = reanchorAnnotations([ann('stress', 0, 4)], oldText, newText);
    assert.equal(dropped, 0);
    assert.equal(annotations.length, 1);
    assert.equal(newText.slice(annotations[0].start, annotations[0].end), 'Good');
  });

  it('前方に挿入されるとスパンも追従する', () => {
    const oldText = 'Good morning.';
    const newText = 'Oh, Good morning.';
    const { annotations, dropped } = reanchorAnnotations([ann('stress', 5, 12)], oldText, newText);
    assert.equal(dropped, 0);
    assert.equal(newText.slice(annotations[0].start, annotations[0].end), 'morning');
  });

  it('対象の語が消えたら落とす', () => {
    const oldText = 'Good morning.';
    const newText = 'Good evening.';
    const { annotations, dropped } = reanchorAnnotations([ann('stress', 5, 12)], oldText, newText);
    assert.equal(dropped, 1);
    assert.equal(annotations.length, 0);
  });

  it('重複語は出現順位を保って貼り直す', () => {
    const oldText = 'the cat and the dog';
    const newText = 'a the cat and the dog';
    // oldText の2つ目の "the"（index 12）に付けた注釈
    const original = ann('link', 12, 15);
    const { annotations, dropped } = reanchorAnnotations([original], oldText, newText);
    assert.equal(dropped, 0);
    const secondThe = newText.indexOf('the', newText.indexOf('the') + 1);
    assert.equal(annotations[0].start, secondThe);
    assert.equal(newText.slice(annotations[0].start, annotations[0].end), 'the');
    assert.equal(annotations[0].id, original.id); // id は保たれる
  });
});
