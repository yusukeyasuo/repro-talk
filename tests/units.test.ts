import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calcStreak,
  buildHeatmap,
  shiftDate,
  summarizeWeeklyGoal,
  weekStartJst,
} from '../src/lib/activity.ts';
import { parseCompositionsCsv } from '../src/lib/composition-csv.ts';
import {
  buildIdeaSeedGroups,
  dedupeCompositionIdeas,
  type CompositionSeed,
} from '../src/lib/composition-ideas.ts';
import { parseMonologueTopicsCsv } from '../src/lib/monologue-topic-csv.ts';
import { dedupeTopicSuggestions, normalizeTopicKey } from '../src/lib/topic-suggestions.ts';
import { ttsCacheKey } from '../src/lib/tts-cache.ts';
import { isLocalSupabase, localMailboxUrl } from '../src/lib/local-dev.ts';
import {
  elapsedSec,
  endedAtFrom,
  formatClock,
  formatDurationHm,
  jstDateOf,
  jstIsoFrom,
  jstTimeOf,
} from '../src/lib/study.ts';
import {
  cleanTranscript,
  parseLeadingTimestampSeconds,
  splitSentences,
  trimTranscriptToRange,
} from '../src/lib/transcript.ts';
import { TRANSCRIPT_BOOKMARKLET_HREF } from '../src/lib/transcript-bookmarklet.ts';
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

describe('transcript: 行頭タイムスタンプを秒に変換する', () => {
  it('m:ss と h:mm:ss', () => {
    assert.equal(parseLeadingTimestampSeconds('0:05 hi'), 5);
    assert.equal(parseLeadingTimestampSeconds('1:30 hi'), 90);
    assert.equal(parseLeadingTimestampSeconds('1:02:03 hi'), 3723);
  });

  it('角括弧・丸括弧つき', () => {
    assert.equal(parseLeadingTimestampSeconds('[00:12] hi'), 12);
    assert.equal(parseLeadingTimestampSeconds('(2:00) hi'), 120);
  });

  it('タイムスタンプが無ければ null', () => {
    assert.equal(parseLeadingTimestampSeconds('Good morning.'), null);
    assert.equal(parseLeadingTimestampSeconds(''), null);
  });
});

describe('transcript: 貼り付けた全文を clip の区間に絞る', () => {
  // ブックマークレットが吐く形（動画全体の m:ss テキスト）
  const full = [
    '0:00 Intro line one.',
    '0:03 Intro line two.',
    '0:30 Good morning.',
    '0:33 Incredibly, the cherry blossom',
    '0:36 survived yet another storm.',
    '1:00 Outro.',
  ].join('\n');

  it('[30, 60) に重なるキューだけ残して整形する', () => {
    const result = trimTranscriptToRange(full, 30, 60);
    assert.equal(result.hadTimestamps, true);
    assert.equal(result.keptCues, 3);
    assert.equal(
      result.text,
      'Good morning. Incredibly, the cherry blossom survived yet another storm.',
    );
  });

  it('区間の開始をまたぐキューは取りこぼさない', () => {
    // 開始 34 は 0:33 のキュー内。そのキューを含める
    const result = trimTranscriptToRange(full, 34, 60);
    assert.equal(result.keptCues, 2);
    assert.equal(result.text, 'Incredibly, the cherry blossom survived yet another storm.');
  });

  it('該当が無ければ keptCues=0・空文字', () => {
    const result = trimTranscriptToRange(full, 300, 360);
    assert.equal(result.hadTimestamps, true);
    assert.equal(result.keptCues, 0);
    assert.equal(result.text, '');
  });

  it('タイムスタンプが無ければ整形だけして hadTimestamps=false', () => {
    const result = trimTranscriptToRange('Good morning. Incredibly the storm.', 0, 30);
    assert.equal(result.hadTimestamps, false);
    assert.equal(result.text, 'Good morning. Incredibly the storm.');
  });
});

describe('transcript-bookmarklet: 生成される javascript: URL', () => {
  it('javascript: で始まり本体が埋め込まれている', () => {
    assert.ok(TRANSCRIPT_BOOKMARKLET_HREF.startsWith('javascript:'));
    // ミニファイ／DCE で本体が落ちていないことの番人
    assert.match(TRANSCRIPT_BOOKMARKLET_HREF, /captionTracks/);
    assert.match(TRANSCRIPT_BOOKMARKLET_HREF, /ytd-transcript-segment-renderer/);
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

describe('local-dev: ローカル Supabase の判定と Mailpit の URL', () => {
  it('ローカルなら Mailpit の URL を返す', () => {
    assert.equal(localMailboxUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54324');
    assert.equal(localMailboxUrl('http://localhost:54321'), 'http://localhost:54324');
  });

  it('クラウドの Supabase では null（＝本物のメールが届く）', () => {
    assert.equal(localMailboxUrl('https://abcdefg.supabase.co'), null);
    assert.equal(isLocalSupabase('https://abcdefg.supabase.co'), false);
  });

  it('未設定・不正な URL でも落ちない', () => {
    assert.equal(localMailboxUrl(undefined), null);
    assert.equal(localMailboxUrl(''), null);
    assert.equal(localMailboxUrl('not a url'), null);
    assert.equal(isLocalSupabase(undefined), false);
  });
});

describe('activity: 連続日数とヒートマップ', () => {
  const row = (activity_date: string, reps = 1): DailyActivity => ({
    user_id: 'u',
    activity_date,
    reproduction_reps: reps,
    monologue_sec: 0,
    recording_sec: 0,
    composition_reps: 0,
    study_sec: 0,
  });

  const compositionRow = (activity_date: string, compositionReps = 1): DailyActivity => ({
    user_id: 'u',
    activity_date,
    reproduction_reps: 0,
    monologue_sec: 0,
    recording_sec: 0,
    composition_reps: compositionReps,
    study_sec: 0,
  });

  const studyRow = (activity_date: string, studySec: number, monologueSec = 0): DailyActivity => ({
    user_id: 'u',
    activity_date,
    reproduction_reps: 0,
    monologue_sec: monologueSec,
    recording_sec: 0,
    composition_reps: 0,
    study_sec: studySec,
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

  it('瞬間英作文だけの日も連続日数に数える', () => {
    assert.equal(
      calcStreak(
        [compositionRow('2026-08-01'), compositionRow('2026-07-31'), row('2026-07-30')],
        '2026-08-01',
      ),
      3,
    );
  });

  it('瞬間英作文の回数もヒートマップの濃さに効く', () => {
    const heatmap = buildHeatmap([compositionRow('2026-08-01', 30)], 12, '2026-08-01');
    const today = heatmap.at(-1)?.find((cell) => cell.date === '2026-08-01');
    assert.ok(today);
    assert.equal(today.level, 4);
    assert.equal(today.compositionReps, 30);
  });

  it('学習時間だけの日も連続日数に数える', () => {
    assert.equal(
      calcStreak([studyRow('2026-08-01', 600), studyRow('2026-07-31', 600)], '2026-08-01'),
      2,
    );
  });

  it('学習時間と独り言の時間は二重に濃くしない（大きいほうだけを採る）', () => {
    // 学習20分・そのうち独り言15分。足すと 35 だが、採るのは 20。
    const cell = (rows: DailyActivity[]) =>
      buildHeatmap(rows, 12, '2026-08-01')
        .at(-1)
        ?.find((c) => c.date === '2026-08-01');

    const both = cell([studyRow('2026-08-01', 20 * 60, 15 * 60)]);
    const studyOnly = cell([studyRow('2026-08-01', 20 * 60)]);
    assert.ok(both && studyOnly);
    assert.equal(both.level, studyOnly.level);
    assert.equal(both.studySec, 20 * 60);
  });
});

describe('activity: 週の学習目標', () => {
  const studyRow = (activity_date: string, studySec: number): DailyActivity => ({
    user_id: 'u',
    activity_date,
    reproduction_reps: 0,
    monologue_sec: 0,
    recording_sec: 0,
    composition_reps: 0,
    study_sec: studySec,
  });

  it('週は月曜始まり。日曜は前の月曜に属する', () => {
    // 2026-08-24(月) 〜 2026-08-30(日)
    assert.equal(weekStartJst('2026-08-24'), '2026-08-24'); // 月曜そのもの
    assert.equal(weekStartJst('2026-08-29'), '2026-08-24'); // 土曜
    assert.equal(weekStartJst('2026-08-30'), '2026-08-24'); // 日曜は同じ週の末日
    assert.equal(weekStartJst('2026-08-31'), '2026-08-31'); // 翌月曜で切り替わる
  });

  it('月・年をまたぐ週でも崩れない', () => {
    assert.equal(weekStartJst('2026-01-01'), '2025-12-29'); // 木曜
    assert.equal(weekStartJst('2026-03-01'), '2026-02-23'); // 日曜
  });

  it('進捗・残り・ペースを出す（水曜時点）', () => {
    const rows = [
      studyRow('2026-08-24', 60 * 60), // 月 1時間
      studyRow('2026-08-25', 30 * 60), // 火 30分
      studyRow('2026-08-26', 30 * 60), // 水 30分
      studyRow('2026-08-23', 99 * 60), // 前の週。混ざらないこと
    ];
    const s = summarizeWeeklyGoal(rows, 7 * 3600, '2026-08-26');

    assert.equal(s.weekStart, '2026-08-24');
    assert.equal(s.weekEnd, '2026-08-30');
    assert.equal(s.studySec, 2 * 3600);
    assert.equal(s.achieved, false);
    assert.equal(s.remainingSec, 5 * 3600);
    assert.equal(s.remainingDays, 5); // 水・木・金・土・日
    assert.equal(s.perDaySec, 3600);
    assert.equal(s.paceSec, 3 * 3600); // 目標7時間 × 3日/7日
    assert.equal(s.behind, true); // 2時間 < 3時間
    assert.equal(s.days.length, 7);
    assert.deepEqual(
      s.days.map((d) => d.label),
      ['月', '火', '水', '木', '金', '土', '日'],
    );
    assert.equal(s.days[2].isToday, true);
    assert.equal(s.days[3].isFuture, true);
  });

  it('達成したら残りは0で頭打ち、超過は ratio に残る', () => {
    const s = summarizeWeeklyGoal([studyRow('2026-08-24', 10 * 3600)], 7 * 3600, '2026-08-30');
    assert.equal(s.achieved, true);
    assert.equal(s.remainingSec, 0);
    assert.equal(s.remainingDays, 1); // 日曜
    assert.equal(s.perDaySec, 0);
    assert.equal(Math.round(s.ratio * 100), 143);
    assert.equal(s.behind, false);
  });

  it('目標未設定（0）なら達成にも未達にもしない', () => {
    const s = summarizeWeeklyGoal([studyRow('2026-08-24', 3600)], 0, '2026-08-26');
    assert.equal(s.studySec, 3600);
    assert.equal(s.ratio, 0);
    assert.equal(s.achieved, false);
    assert.equal(s.behind, false);
  });
});

describe('study: 学習時間の計測', () => {
  it('経過時間は開始時刻と今の差（カウンタを持たないのでリロードで狂わない）', () => {
    const started = '2026-08-29T12:00:00.000Z';
    assert.equal(elapsedSec(started, Date.parse('2026-08-29T12:25:30.000Z')), 25 * 60 + 30);
    // 端末の時計が巻き戻っても負にはしない
    assert.equal(elapsedSec(started, Date.parse('2026-08-29T11:59:00.000Z')), 0);
    assert.equal(elapsedSec('not a date'), 0);
  });

  it('計測中の時計は1時間を超えたら h:mm:ss になる', () => {
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(65), '01:05');
    assert.equal(formatClock(3600), '1:00:00');
    assert.equal(formatClock(3661), '1:01:01');
  });

  it('学習時間の表示は「1時間35分」形式。0でない1分未満は切り捨てない', () => {
    assert.equal(formatDurationHm(0), '0分');
    assert.equal(formatDurationHm(30), '1分未満');
    assert.equal(formatDurationHm(60), '1分');
    assert.equal(formatDurationHm(35 * 60), '35分');
    assert.equal(formatDurationHm(3600), '1時間');
    assert.equal(formatDurationHm(3600 + 35 * 60), '1時間35分');
  });

  it('日付・時刻は端末のタイムゾーンに依らず JST で読む', () => {
    // UTC 2026-08-29 15:30 は JST では翌日 00:30
    assert.equal(jstDateOf('2026-08-29T15:30:00.000Z'), '2026-08-30');
    assert.equal(jstTimeOf('2026-08-29T15:30:00.000Z'), '00:30');
    assert.equal(jstTimeOf('2026-08-29T00:05:00.000Z'), '09:05');
  });

  it('JST の日付＋時刻から ISO を作る（+09:00 を明示して解釈する）', () => {
    assert.equal(jstIsoFrom('2026-08-29', '21:00'), '2026-08-29T12:00:00.000Z');
    assert.equal(jstIsoFrom('2026-08-29', '00:30'), '2026-08-28T15:30:00.000Z');
    assert.equal(jstIsoFrom('2026/08/29', '21:00'), null);
    assert.equal(jstIsoFrom('2026-08-29', '9:00'), null);
  });

  it('あとから直すときは「開始 + 時間」で終了時刻を作り直す', () => {
    assert.equal(
      endedAtFrom('2026-08-29T12:00:00.000Z', 35 * 60),
      '2026-08-29T12:35:00.000Z',
    );
    // 上限（12時間）を超える入力は丸める。誤入力で連続日数を壊さない
    assert.equal(
      endedAtFrom('2026-08-29T12:00:00.000Z', 99 * 3600),
      '2026-08-30T00:00:00.000Z',
    );
    assert.equal(endedAtFrom('2026-08-29T12:00:00.000Z', -60), '2026-08-29T12:00:00.000Z');
    assert.equal(endedAtFrom('not a date', 60), null);
  });
});

describe('composition-csv: 瞬間英作文の一括登録パース', () => {
  it('素直なカンマ区切り', () => {
    const { rows, skipped } = parseCompositionsCsv('私はペンです,I am a pen.\n君は鳥だ,You are a bird.');
    assert.deepEqual(rows, [
      { ja: '私はペンです', en: 'I am a pen.' },
      { ja: '君は鳥だ', en: 'You are a bird.' },
    ]);
    assert.equal(skipped, 0);
  });

  it('英文にカンマが入る場合はクオートで守る（RFC4180）', () => {
    const { rows } = parseCompositionsCsv('なるほど,"I see, that makes sense."');
    assert.deepEqual(rows, [{ ja: 'なるほど', en: 'I see, that makes sense.' }]);
  });

  it('"" は 1 個の引用符にほどく', () => {
    const { rows } = parseCompositionsCsv('引用,"He said ""hi"" to me."');
    assert.deepEqual(rows, [{ ja: '引用', en: 'He said "hi" to me.' }]);
  });

  it('タブ区切り（スプレッドシートからの貼り付け）も受ける', () => {
    const { rows } = parseCompositionsCsv('私はペンです\tI am a pen.\n君は鳥だ\tYou are a bird.');
    assert.deepEqual(rows, [
      { ja: '私はペンです', en: 'I am a pen.' },
      { ja: '君は鳥だ', en: 'You are a bird.' },
    ]);
  });

  it('見出し行は落とす', () => {
    const { rows } = parseCompositionsCsv('日本語,英語\n私はペンです,I am a pen.');
    assert.deepEqual(rows, [{ ja: '私はペンです', en: 'I am a pen.' }]);
  });

  it('空行は無視し、片側が欠けた行は skipped に数える', () => {
    const { rows, skipped } = parseCompositionsCsv(
      '私はペンです,I am a pen.\n\n欠けてる行\n君は鳥だ,You are a bird.\n',
    );
    assert.deepEqual(rows, [
      { ja: '私はペンです', en: 'I am a pen.' },
      { ja: '君は鳥だ', en: 'You are a bird.' },
    ]);
    assert.equal(skipped, 1);
  });

  it('クオート内の改行・CRLF・BOM を通す', () => {
    const { rows } = parseCompositionsCsv('﻿複数行,"line1\nline2"\r\n次,next\r\n');
    assert.deepEqual(rows, [
      { ja: '複数行', en: 'line1\nline2' },
      { ja: '次', en: 'next' },
    ]);
  });

  it('空文字は空配列', () => {
    assert.deepEqual(parseCompositionsCsv('   '), { rows: [], skipped: 0 });
  });
});

describe('tts-cache: クラウドTTSのキャッシュキー', () => {
  it('同じ文・声・モデルは同じキー（.mp3）', () => {
    const a = ttsCacheKey('Hello world.');
    const b = ttsCacheKey('Hello world.');
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}\.mp3$/);
  });

  it('前後空白・連続空白は正規化して同じキーになる', () => {
    assert.equal(ttsCacheKey('  Hello   world. '), ttsCacheKey('Hello world.'));
  });

  it('声が違えばキーも変わる', () => {
    assert.notEqual(
      ttsCacheKey('Hello world.', { voice: 'alloy' }),
      ttsCacheKey('Hello world.', { voice: 'nova' }),
    );
  });

  it('文が違えばキーも変わる', () => {
    assert.notEqual(ttsCacheKey('Hello world.'), ttsCacheKey('Goodbye world.'));
  });
});

describe('monologue-topic-csv: 独り言のお題の一括登録パース', () => {
  it('英語が先、日本語が後（英作文とは逆の並び）', () => {
    const { rows, skipped } = parseMonologueTopicsCsv(
      'What I did today,今日やったこと\nMy hometown,地元の話',
    );
    assert.deepEqual(rows, [
      { titleEn: 'What I did today', titleJa: '今日やったこと' },
      { titleEn: 'My hometown', titleJa: '地元の話' },
    ]);
    assert.equal(skipped, 0);
  });

  it('スプレッドシート由来のタブ区切り', () => {
    const { rows } = parseMonologueTopicsCsv('My hobbies\t趣味の話');
    assert.deepEqual(rows, [{ titleEn: 'My hobbies', titleJa: '趣味の話' }]);
  });

  it('お題にカンマが入っても引用符で守れる', () => {
    const { rows } = parseMonologueTopicsCsv('"Work, life, and the gap",仕事と生活の間');
    assert.deepEqual(rows, [{ titleEn: 'Work, life, and the gap', titleJa: '仕事と生活の間' }]);
  });

  it('見出し行を落とす', () => {
    const { rows, skipped } = parseMonologueTopicsCsv('英語,日本語\nMy hometown,地元の話');
    assert.deepEqual(rows, [{ titleEn: 'My hometown', titleJa: '地元の話' }]);
    assert.equal(skipped, 0);
  });

  it('片方だけの行はスキップし、空行は数えない', () => {
    const { rows, skipped } = parseMonologueTopicsCsv('My hometown,地元の話\nOnly English\n\n');
    assert.deepEqual(rows, [{ titleEn: 'My hometown', titleJa: '地元の話' }]);
    assert.equal(skipped, 1);
  });

  it('空文字は0件', () => {
    assert.deepEqual(parseMonologueTopicsCsv('   '), { rows: [], skipped: 0 });
  });
});

describe('dedupeTopicSuggestions', () => {
  const suggest = (titleEn: string, titleJa: string, whyJa = '') => ({ titleEn, titleJa, whyJa });

  it('記号・大文字小文字・空白の違いを畳んで同じキーにする', () => {
    assert.equal(
      normalizeTopicKey('My job, explained simply'),
      normalizeTopicKey('my job explained simply'),
    );
    assert.notEqual(normalizeTopicKey('今日やった仕事'), normalizeTopicKey('今日やったこと'));
  });

  it('既存のお題と一致する候補を落とす（英語・日本語のどちらか一致で落ちる）', () => {
    const kept = dedupeTopicSuggestions(
      [
        suggest('My job, explained simply', '仕事を簡単に説明する'),
        suggest('A different angle', '今日やったこと'),
        suggest('What I worked on today', '今日やった仕事'),
      ],
      [
        { titleEn: 'my job explained simply', titleJa: '自分の仕事を簡単に説明する' },
        { titleEn: 'What I did today', titleJa: '今日やったこと' },
      ],
    );
    assert.deepEqual(kept, [suggest('What I worked on today', '今日やった仕事')]);
  });

  it('似ているだけの候補は落とさない（採否は本人に残す）', () => {
    const kept = dedupeTopicSuggestions(
      [suggest('What I worked on today', '今日やった仕事')],
      [{ titleEn: 'What I did today', titleJa: '今日やったこと' }],
    );
    assert.equal(kept.length, 1);
  });

  it('応答の中の重複も畳む', () => {
    const kept = dedupeTopicSuggestions(
      [
        suggest('A meeting I had today', '今日あった会議'),
        suggest('A meeting I had today.', '今日の打ち合わせ'),
        suggest('Another meeting', '今日あった会議'),
      ],
      [],
    );
    assert.deepEqual(kept, [suggest('A meeting I had today', '今日あった会議')]);
  });

  it('片方が空の候補と、前後の空白だけの候補は落とす', () => {
    const kept = dedupeTopicSuggestions(
      [suggest('Only English', ''), suggest('  ', '日本語だけ'), suggest(' Kept ', ' 残る ', ' 理由 ')],
      [],
    );
    assert.deepEqual(kept, [suggest('Kept', '残る', '理由')]);
  });

  it('existing の日本語が空でも、全部の候補を落としたりしない', () => {
    const kept = dedupeTopicSuggestions(
      [suggest('A new one', '新しいお題')],
      [{ titleEn: 'Already shown', titleJa: '' }],
    );
    assert.equal(kept.length, 1);
  });
});

describe('composition-ideas: 応用練習の材料を束ねる', () => {
  const pool = (n: number): CompositionSeed[] =>
    Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, ja: `日本語${i}`, en: `English ${i}` }));

  // rng を差して決定的にする（本番は Math.random）。0 なら束は2文、0.9 なら3文になる。
  const rngPairs = () => 0;
  const rngTriples = () => 0.9;

  it('例文が2件未満だと組み合わせようがないので空を返す', () => {
    assert.deepEqual(buildIdeaSeedGroups(pool(1), 5, rngPairs), []);
    assert.deepEqual(buildIdeaSeedGroups(pool(0), 5, rngPairs), []);
  });

  it('件数が0以下なら空を返す', () => {
    assert.deepEqual(buildIdeaSeedGroups(pool(10), 0, rngPairs), []);
  });

  it('求めた数だけ、2〜3文の束を作る', () => {
    const groups = buildIdeaSeedGroups(pool(10), 4, rngTriples);
    assert.equal(groups.length, 4);
    assert.deepEqual(
      groups.map((g) => g.group),
      [1, 2, 3, 4],
    );
    for (const group of groups) {
      assert.ok(group.items.length >= 2 && group.items.length <= 3);
      // 同じ束に同じ文を2度入れない
      assert.equal(new Set(group.items.map((i) => i.id)).size, group.items.length);
    }
  });

  it('池を使い切るまで同じ文を2度使わない（コース全体が均等に回る）', () => {
    // 6件から2文 × 3束 = ちょうど1周ぶん
    const groups = buildIdeaSeedGroups(pool(6), 3, rngPairs);
    const used = groups.flatMap((g) => g.items.map((i) => i.id));
    assert.equal(used.length, 6);
    assert.equal(new Set(used).size, 6);
  });

  it('池が2件しかなければ、束は常に2文になる（3文を要求しても増やせない）', () => {
    const groups = buildIdeaSeedGroups(pool(2), 3, rngTriples);
    assert.deepEqual(
      groups.map((g) => g.items.length),
      [2, 2, 2],
    );
  });
});

describe('composition-ideas: 応用問題の候補から重複を落とす', () => {
  const idea = (ja: string, en: string, whyJa = 'ねらい') => ({ ja, en, whyJa, sourceIds: ['s1'] });

  it('コースに既にある例文と日本語が一致するものは落とす', () => {
    const kept = dedupeCompositionIdeas(
      [idea('来週までに見積もりを出します。', 'I will send you the quote by next week.')],
      [{ ja: '来週までに見積もりを出します。', en: 'まったく違う英語' }],
    );
    assert.deepEqual(kept, []);
  });

  it('英語が一致すれば、記号や大文字小文字が違っても落とす', () => {
    const kept = dedupeCompositionIdeas(
      [idea('別の日本語です。', 'I will send you the quote by next week.')],
      [{ ja: 'ぜんぜん違う日本語', en: 'I WILL SEND YOU THE QUOTE BY NEXT WEEK!' }],
    );
    assert.deepEqual(kept, []);
  });

  it('候補どうしの重複は後から来たほうを落とす', () => {
    const kept = dedupeCompositionIdeas(
      [
        idea('確認してから返します。', 'Let me check and get back to you.'),
        idea('確認してから返します。', 'I will check and get back to you.'),
        idea('別の問題です。', 'Let me check and get back to you.'),
        idea('残る問題です。', 'Could you take a look when you have time?'),
      ],
      [],
    );
    assert.deepEqual(
      kept.map((k) => k.ja),
      ['確認してから返します。', '残る問題です。'],
    );
  });

  it('日本語か英語が欠けた候補は登録できないので落とし、残るものは trim する', () => {
    const kept = dedupeCompositionIdeas(
      [idea('日本語だけ', ''), idea('  ', 'English only'), idea(' 残る ', ' Kept as is ', ' 理由 ')],
      [],
    );
    assert.deepEqual(kept, [{ ja: '残る', en: 'Kept as is', whyJa: '理由', sourceIds: ['s1'] }]);
  });

  it('元にした例文の id は保ったまま返す（画面で元の文を出すため）', () => {
    const kept = dedupeCompositionIdeas(
      [{ ja: '新しい問題', en: 'A new one', whyJa: '', sourceIds: ['a', 'b'] }],
      [],
    );
    assert.deepEqual(kept[0].sourceIds, ['a', 'b']);
  });
});
