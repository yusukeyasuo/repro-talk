import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calcStreak, buildHeatmap, shiftDate } from '../src/lib/activity.ts';
import { cleanTranscript, splitSentences } from '../src/lib/transcript.ts';
import { extractVideoId, formatDurationJa, formatSeconds } from '../src/lib/youtube.ts';
import { normalizeAnnotations } from '../src/types/annotation.ts';
import type { DailyActivity } from '../src/types/database.ts';

describe('youtube: URL から video ID を取り出す', () => {
  it('watch URL', () => {
    assert.equal(extractVideoId('https://www.youtube.com/watch?v=by5nmulWGHM'), 'by5nmulWGHM');
  });

  it('プレイリスト付きの watch URL', () => {
    assert.equal(
      extractVideoId('https://www.youtube.com/watch?v=by5nmulWGHM&list=PLxNIYrKvjut&index=8'),
      'by5nmulWGHM',
    );
  });

  it('youtu.be / shorts / embed', () => {
    assert.equal(extractVideoId('https://youtu.be/by5nmulWGHM?t=90'), 'by5nmulWGHM');
    assert.equal(extractVideoId('https://www.youtube.com/shorts/by5nmulWGHM'), 'by5nmulWGHM');
    assert.equal(extractVideoId('https://www.youtube.com/embed/by5nmulWGHM'), 'by5nmulWGHM');
  });

  it('生の ID とプロトコルなし', () => {
    assert.equal(extractVideoId('by5nmulWGHM'), 'by5nmulWGHM');
    assert.equal(extractVideoId('youtube.com/watch?v=by5nmulWGHM'), 'by5nmulWGHM');
  });

  it('関係ない URL は null', () => {
    assert.equal(extractVideoId('https://example.com/hello'), null);
    assert.equal(extractVideoId('   '), null);
  });
});

describe('youtube: 時間の表示', () => {
  it('区間表示は m:ss', () => {
    assert.equal(formatSeconds(90.4), '1:30');
    assert.equal(formatSeconds(-5), '0:00');
  });

  it('録音時間は日本語', () => {
    assert.equal(formatDurationJa(45), '45秒');
    assert.equal(formatDurationJa(90), '1分30秒');
    assert.equal(formatDurationJa(120), '2分');
  });
});

describe('transcript: 文字起こしパネルの貼り付けを整形する', () => {
  // 実際に YouTube の「文字起こしを表示」からコピーした形
  const raw = [
    '1:30 Good morning.',
    '1:33 Incredibly, the cherry blossom',
    '1:36 survived yet another storm.',
    '1:39 [音楽]',
    '1:41 I really thought I was gonna say goodbye.',
  ].join('\n');

  it('タイムスタンプを除去して本文を連結する', () => {
    const result = cleanTranscript(raw);
    assert.equal(result.removedTimestamps, 5);
    assert.equal(
      result.text,
      'Good morning. Incredibly, the cherry blossom survived yet another storm. ' +
        'I really thought I was gonna say goodbye.',
    );
  });

  it('角括弧・丸括弧・時:分:秒・単独行のタイムスタンプも除去する', () => {
    const result = cleanTranscript('[00:12] Hello there\n(1:02:03) Second line\n0:05\nThird line');
    assert.equal(result.removedTimestamps, 3);
    assert.equal(result.text, 'Hello there Second line Third line');
  });
});

describe('transcript: 1文ずつ止める練習のために文へ分割する', () => {
  it('オフセットが原文と一致する', () => {
    const text = cleanTranscript(
      '1:30 Good morning.\n1:33 Incredibly, the cherry blossom survived yet another storm.',
    ).text;
    const sentences = splitSentences(text);
    assert.equal(sentences.length, 2);
    for (const sentence of sentences) {
      assert.equal(text.slice(sentence.start, sentence.end), sentence.text);
    }
  });

  it('先頭が句読点でもオフセットがずれない', () => {
    const text = '... Wait. Really?';
    for (const sentence of splitSentences(text)) {
      assert.equal(text.slice(sentence.start, sentence.end), sentence.text);
    }
  });

  it('空文字は空配列', () => {
    assert.deepEqual(splitSentences(''), []);
  });
});

describe('annotation: AI と手入力の両方を正規化する', () => {
  const transcript = 'Good morning. I really thought I was gonna say goodbye.';

  it('範囲外・空範囲・未知の種別を落とす', () => {
    const result = normalizeAnnotations(
      [
        { type: 'drop', start: 3, end: 4 },
        { type: 'reduction', start: 34, end: 39, surface: 'gonna' },
        { type: 'flap_t', start: 999, end: 1000 },
        { type: 'stress', start: 5, end: 5 },
        { type: 'bogus', start: 0, end: 4 },
        'not an object',
        { type: 'link', start: -5, end: 4 },
      ],
      transcript.length,
    );

    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((a) => a.type),
      ['link', 'drop', 'reduction'],
    );
    assert.equal(result[0].start, 0);
    assert.equal(result[2].surface, 'gonna');
    assert.ok(result.every((a) => typeof a.id === 'string' && a.id.length > 0));
  });

  it('重複 id を振り直す', () => {
    const result = normalizeAnnotations(
      [
        { id: 'x', type: 'stress', start: 0, end: 4 },
        { id: 'x', type: 'link', start: 5, end: 9 },
      ],
      transcript.length,
    );
    assert.equal(result.length, 2);
    assert.notEqual(result[0].id, result[1].id);
  });

  it('配列でなければ空配列', () => {
    assert.deepEqual(normalizeAnnotations(null, 10), []);
    assert.deepEqual(normalizeAnnotations({ type: 'stress' }, 10), []);
  });
});

describe('activity: 連続日数とヒートマップ', () => {
  const row = (activity_date: string, reps = 1): DailyActivity => ({
    user_id: 'u',
    activity_date,
    reproduction_reps: reps,
    monologue_sec: 0,
    recording_sec: 0,
  });

  it('日付の加減算が月・年をまたぐ', () => {
    assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
    assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  });

  it('今日を含む連続日数を数える', () => {
    assert.equal(
      calcStreak([row('2026-08-01'), row('2026-07-31'), row('2026-07-30')], '2026-08-01'),
      3,
    );
  });

  it('今日まだ未着手なら昨日から数える（日付が変わるまで途切れ扱いにしない）', () => {
    assert.equal(calcStreak([row('2026-07-31'), row('2026-07-30')], '2026-08-01'), 2);
  });

  it('途切れていれば 0', () => {
    assert.equal(calcStreak([row('2026-07-30')], '2026-08-01'), 0);
    assert.equal(calcStreak([row('2026-07-31', 0), row('2026-07-30')], '2026-08-01'), 0);
    assert.equal(calcStreak([], '2026-08-01'), 0);
  });

  it('12週 × 7日のグリッドに今日が含まれる', () => {
    const heatmap = buildHeatmap([row('2026-08-01', 30)], 12, '2026-08-01');
    assert.equal(heatmap.length, 12);
    assert.ok(heatmap.every((week) => week.length === 7));

    const today = heatmap.at(-1)?.find((cell) => cell.date === '2026-08-01');
    assert.ok(today);
    assert.equal(today.level, 4);
  });
});
