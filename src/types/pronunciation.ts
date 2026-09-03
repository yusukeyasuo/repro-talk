/**
 * 発音記号（IPA）。単語ごとの読みを transcript の文字インデックス [start, end) で持つ。
 * 「その語がどう読まれるか」は辞書の仕事で、連結・脱落のような**その文での音の変化**は
 * annotations（音の記号）のほうが担う。役割が違うので別のデータにしている。
 */
export type Pronunciation = {
  /** transcript の文字インデックス（0起点） */
  start: number;
  /** 排他。start < end */
  end: number;
  /** IPA。スラッシュや角括弧は付けない（例: təˈdeɪ） */
  ipa: string;
};

/** 英単語として扱うかたまり。語中のアポストロフィ・ハイフンは語の一部。 */
const WORD = /[A-Za-z](?:[A-Za-z'’-]*[A-Za-z])?/g;

export type WordToken = { word: string; start: number; end: number };

/** transcript を単語に切る。発音記号は語ごとなので、この単位で AI の出力と突き合わせる。 */
export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(WORD)) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** 突き合わせ用に語を丸める（大文字小文字・カーリークォートの違いを無視する）。 */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[’']/g, "'");
}

/** 不正な範囲・重なりを落として正規化する。AI の出力も保存済みの値もここを通す。 */
export function normalizePronunciations(
  input: unknown,
  transcriptLength: number,
): Pronunciation[] {
  if (!Array.isArray(input)) return [];

  const out: Pronunciation[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as Partial<Pronunciation>;

    const ipa = typeof p.ipa === 'string' ? p.ipa.trim() : '';
    if (!ipa) continue;

    const start = Math.trunc(Number(p.start));
    const end = Math.trunc(Number(p.end));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const clampedStart = Math.max(0, Math.min(start, transcriptLength));
    const clampedEnd = Math.max(0, Math.min(end, transcriptLength));
    if (clampedEnd <= clampedStart) continue;

    out.push({ start: clampedStart, end: clampedEnd, ipa });
  }

  out.sort((x, y) => x.start - y.start || x.end - y.end);

  // 1つの語に2つの読みが乗ると行が二重になるので、同じ位置は先勝ちで1つにする
  const deduped: Pronunciation[] = [];
  for (const p of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.start === p.start) continue;
    deduped.push(p);
  }
  return deduped;
}
