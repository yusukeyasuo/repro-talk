/**
 * YouTube の「文字起こしを表示」パネルからコピーしたテキストを整形する。
 *
 * 文字起こしの自動取得はしない。YouTube の公式 API 経路は現状ほぼ塞がれており、
 * 安定して取れないため「パネルからコピペ」を正規の動線にしている。
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
