/**
 * 発音記号のアンカリング。
 *
 * AI には「語ごとの読み」を出現順に返させ、こちらで transcript を単語に切って
 * 前から突き合わせ、オフセットを復元する（注釈と同じ考え方＝LLM に整数の位置を
 * 数えさせない）。同じ語が何度も出てくるので語をキーにした辞書にはしない。
 * read / live のように文脈で読みが変わる語を取り違えないため。
 */
// 相対 + .ts 拡張子は、素の node（npm test）でも実行時に解決できるようにするため。
import { reanchorRange } from './annotation-anchor.ts';
import {
  normalizePronunciations,
  normalizeWord,
  tokenizeWords,
  type Pronunciation,
} from '../types/pronunciation.ts';

/** AI が語ベースで返す発音記号の生の形。 */
export type AiWordIpa = {
  /** スクリプトに出てくる語（前後の記号は無視する） */
  word: string;
  /** IPA */
  ipa: string;
};

/**
 * AI の「語 + IPA」の並びを transcript 上の [start, end) に解決する。
 * 出現順に前から突き合わせ、スクリプトに無い語（取りこぼし・幻）はその項目だけ捨てる。
 * 最後に normalizePronunciations を最終防波堤として通す。
 */
export function resolveAiPronunciations(items: unknown, transcript: string): Pronunciation[] {
  if (!Array.isArray(items)) return [];

  const tokens = tokenizeWords(transcript);
  const resolved: Pronunciation[] = [];
  let cursor = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rawWord = typeof (item as AiWordIpa).word === 'string' ? (item as AiWordIpa).word : '';
    const rawIpa = typeof (item as AiWordIpa).ipa === 'string' ? (item as AiWordIpa).ipa : '';
    if (!rawWord || !rawIpa.trim()) continue;

    // AI が "big." のように記号ごと返しても拾えるよう、語だけ取り出して比べる
    const needle = normalizeWord(tokenizeWords(rawWord)[0]?.word ?? '');
    if (!needle) continue;

    let found = -1;
    for (let i = cursor; i < tokens.length; i += 1) {
      if (normalizeWord(tokens[i].word) === needle) {
        found = i;
        break;
      }
    }
    // 見つからなければ cursor は進めない（後ろの語で並びに復帰できる）
    if (found === -1) continue;

    resolved.push({ start: tokens[found].start, end: tokens[found].end, ipa: rawIpa.trim() });
    cursor = found + 1;
  }

  return normalizePronunciations(resolved, transcript.length);
}

/**
 * transcript を編集したとき、発音記号を新テキストへ貼り直す。
 * 注釈と同じく、覆っていた語が新テキストに無いものだけ落とす。
 * 読み自体は語に紐づくので、位置さえ移せればそのまま使える。
 */
export function reanchorPronunciations(
  pronunciations: Pronunciation[],
  oldText: string,
  newText: string,
): Pronunciation[] {
  const kept: Pronunciation[] = [];
  for (const p of pronunciations) {
    const moved = reanchorRange(oldText, newText, p);
    if (!moved) continue; // 消えた語
    kept.push({ ...p, ...moved });
  }
  return normalizePronunciations(kept, newText.length);
}
