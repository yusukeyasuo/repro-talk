/**
 * YouTube の「文字起こしを表示」からコピーしたテキストを整形し、クリップの区間に絞る。
 *
 * サーバー側の自動取得はしない。YouTube の timedtext 経路はデータセンターIPが強く
 * ブロックされ、ブラウザ直叩きは CORS で塞がっているため。代わりにユーザーのブラウザで
 * 動くブックマークレット（`transcript-bookmarklet.ts`）が字幕を取得してクリップボードへ入れ、
 * ここに貼り付ける。手動コピペもフォールバックとして残す。
 *
 * ブックマークレットは `m:ss テキスト` の行を出すので、貼り付けた全文を
 * `trimTranscriptToRange` で clip の [start, end) に重なる行だけへ絞れる。
 */

// 行頭のタイムスタンプ: 0:00 / 00:12 / 1:02:03 / [00:12] / (0:05)
const LEADING_TIMESTAMP = /^\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*/;
// タイムスタンプだけの行
const TIMESTAMP_ONLY = /^\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*$/;

export type CleanTranscriptResult = {
  text: string;
  /** 除去したタイムスタンプの数。UI で「n 個のタイムスタンプを除去しました」と出す。 */
  removedTimestamps: number;
};

export function cleanTranscript(raw: string): CleanTranscriptResult {
  let removed = 0;
  const parts: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (TIMESTAMP_ONLY.test(line)) {
      removed += 1;
      continue;
    }

    let body = line;
    if (LEADING_TIMESTAMP.test(body)) {
      body = body.replace(LEADING_TIMESTAMP, '');
      removed += 1;
    }

    // 自動字幕によく混ざるノイズ
    body = body.replace(/\[(音楽|拍手|笑い|Music|Applause|Laughter)\]/gi, '');

    const trimmed = body.trim();
    if (trimmed) parts.push(trimmed);
  }

  // 字幕は文の途中で改行されるので空白で連結し、空白を正規化する
  const text = parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();

  return { text, removedTimestamps: removed };
}

/**
 * 文単位に分割する。リプロダクションは「1文ずつ止めて再現する」練習なので、
 * エディタでは文ごとに行を分けて表示する。
 * 返り値は元テキストに対する [start, end) のオフセット付き。
 */
export type Sentence = { text: string; start: number; end: number };

export function splitSentences(text: string): Sentence[] {
  if (!text) return [];

  const out: Sentence[] = [];
  // 終端記号 + 続く空白までを1文とみなす
  const re = /[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g;

  for (const m of text.matchAll(re)) {
    const chunk = m[0];
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    // オフセットは m.index を基準にする（マッチが不連続でもズレない）
    const start = m.index + (chunk.length - chunk.trimStart().length);
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }

  return out;
}

// 行頭タイムスタンプの各成分を取る: 0:00 / 00:12 / 1:02:03 / [00:12] / (0:05)
const LEADING_TIMESTAMP_PARTS = /^\s*[[(]?(\d{1,2}):(\d{2})(?::(\d{2}))?[\])]?/;

/**
 * 行頭のタイムスタンプを秒に変換する。無ければ null。
 * 3成分あれば h:mm:ss、2成分なら m:ss とみなす。
 */
export function parseLeadingTimestampSeconds(line: string): number | null {
  const m = line.match(LEADING_TIMESTAMP_PARTS);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (m[3] !== undefined) return a * 3600 + b * 60 + Number(m[3]);
  return a * 60 + b;
}

// 最後のキューは尺が分からないので、この秒数だけ続くとみなして区間判定する
const LAST_CUE_TAIL_SEC = 10;

export type TrimTranscriptResult = {
  /** cleanTranscript を通した最終テキスト */
  text: string;
  /** 入力にタイムスタンプ付きの行が1つでもあったか。無ければ区間で絞れず全文を返す。 */
  hadTimestamps: boolean;
  /** 区間に重なるとして残したキュー数（0なら区間に該当なし） */
  keptCues: number;
};

/**
 * ブックマークレットが吐く `m:ss テキスト` の全文を、clip の [startSec, endSec) に
 * 重なるキューだけへ絞る。各キューの終わりは次のキューの開始で近似する
 * （区間開始をまたぐキューも取りこぼさない）。最後に cleanTranscript で整形する。
 *
 * タイムスタンプが無いテキスト（手で選んだ行など）はそのまま cleanTranscript に流す。
 */
export function trimTranscriptToRange(
  raw: string,
  startSec: number,
  endSec: number,
): TrimTranscriptResult {
  type Cue = { time: number; lines: string[] };
  const cues: Cue[] = [];
  let sawTimestamp = false;

  for (const line of raw.split(/\r?\n/)) {
    const t = parseLeadingTimestampSeconds(line);
    if (t !== null) {
      sawTimestamp = true;
      cues.push({ time: t, lines: [line] });
    } else if (cues.length > 0) {
      // タイムスタンプ無しの継続行は直前のキューにぶら下げる
      cues[cues.length - 1].lines.push(line);
    } else {
      // 最初のタイムスタンプより前の行（説明文など）。区間判定できないので対象外に置く
      cues.push({ time: Number.NEGATIVE_INFINITY, lines: [line] });
    }
  }

  if (!sawTimestamp) {
    return { text: cleanTranscript(raw).text, hadTimestamps: false, keptCues: 0 };
  }

  const kept = cues.filter((cue, i) => {
    if (!Number.isFinite(cue.time)) return false;
    // キューの終端は次キューの開始で近似。最後のキューは尺が不明なので控えめな尾を足す
    // （Infinity にすると区間が動画末尾より後でも最後のキューを拾ってしまう）。
    const cueEnd = cues[i + 1]?.time ?? cue.time + LAST_CUE_TAIL_SEC;
    // 区間 [startSec, endSec) と重なるキューを残す
    return cue.time < endSec && cueEnd > startSec;
  });

  const text = cleanTranscript(kept.map((c) => c.lines.join('\n')).join('\n')).text;
  return { text, hadTimestamps: true, keptCues: kept.length };
}
