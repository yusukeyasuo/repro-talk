/**
 * 注釈のアンカリング。
 *
 * LLM は整数オフセットを外しやすい一方、該当箇所を逐語で引用するのは得意なので、
 * AI には quote（部分文字列）＋ occurrence（何番目の一致か）を返させ、こちらで
 * 文字列照合してオフセットを復元する（judgment 5）。同じ発想で、transcript を
 * 編集したときも「消えた注釈だけ落として残りは貼り直す」（judgment 6）。
 */
// 相対 + .ts 拡張子は、素の node（npm test）でも実行時に解決できるようにするため。
// このモジュールは AI エンドポイント経由の未検証ロジックなのでユニットテスト対象にしている。
import { normalizeAnnotations, type Annotation, type AnnotationType } from '../types/annotation.ts';

/** haystack の中で needle が occurrence 番目（1起点）に始まる位置。無ければ -1。 */
function nthIndexOf(haystack: string, needle: string, occurrence: number): number {
  if (!needle) return -1;
  let idx = -1;
  for (let n = 0; n < occurrence; n += 1) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

/** text 内で at の位置に始まる needle が何番目（1起点）の一致か。無ければ -1。 */
function occurrenceAt(text: string, needle: string, at: number): number {
  if (!needle) return -1;
  let count = 0;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    if (idx === at) return count;
    idx = text.indexOf(needle, idx + 1);
  }
  return -1;
}

/** target に最も近い needle の開始位置。無ければ -1。 */
function nearestIndexOf(text: string, needle: string, target: number): number {
  if (!needle) return -1;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    const dist = Math.abs(idx - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
    idx = text.indexOf(needle, idx + 1);
  }
  return best;
}

/** AI が quote ベースで返す注釈の生の形。 */
export type AiAnnotationItem = {
  type: AnnotationType;
  /** 原文から1文字も変えずコピーした対象部分。 */
  quote: string;
  /** 同じ quote が複数あるとき何番目か（1起点）。 */
  occurrence?: number;
  /** reduction のときの実際の音。 */
  surface?: string;
  note?: string;
};

/**
 * AI の quote/occurrence 出力を transcript 上の [start, end) に解決する。
 * occurrence 番目が見つからなければ最初の一致にフォールバックし、
 * それも無ければ捨てる。最後に normalizeAnnotations を最終防波堤として通す。
 */
export function resolveAiAnnotations(items: unknown, transcript: string): Annotation[] {
  const raw: Partial<Annotation>[] = [];
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const quote = typeof (item as AiAnnotationItem).quote === 'string' ? (item as AiAnnotationItem).quote : '';
      if (!quote) continue;

      const occRaw = Number((item as AiAnnotationItem).occurrence);
      const occurrence = Number.isFinite(occRaw) ? Math.max(1, Math.trunc(occRaw)) : 1;

      let start = nthIndexOf(transcript, quote, occurrence);
      if (start === -1) start = transcript.indexOf(quote); // 番号がずれても最初の一致で拾う
      if (start === -1) continue; // 原文に無い＝取りこぼし

      raw.push({
        type: (item as AiAnnotationItem).type,
        start,
        end: start + quote.length,
        surface: typeof (item as AiAnnotationItem).surface === 'string' ? (item as AiAnnotationItem).surface : undefined,
        note: typeof (item as AiAnnotationItem).note === 'string' ? (item as AiAnnotationItem).note : undefined,
      });
    }
  }
  return normalizeAnnotations(raw, transcript.length);
}

/**
 * transcript を編集したとき、注釈を新テキストへ貼り直す。
 * 各注釈が旧テキストで覆っていた部分文字列を、旧テキストでの出現順位のまま
 * 新テキストの同順位へ移す。順位が無ければ最も近い一致へ。どこにも無ければ落とす。
 */
export function reanchorAnnotations(
  annotations: Annotation[],
  oldText: string,
  newText: string,
): { annotations: Annotation[]; dropped: number } {
  const kept: Annotation[] = [];
  for (const a of annotations) {
    const quote = oldText.slice(a.start, a.end);
    if (!quote) continue;

    const occurrence = occurrenceAt(oldText, quote, a.start);
    let start = occurrence > 0 ? nthIndexOf(newText, quote, occurrence) : -1;
    if (start === -1) start = nearestIndexOf(newText, quote, a.start);
    if (start === -1) continue; // 消えた

    kept.push({ ...a, start, end: start + quote.length });
  }
  const result = normalizeAnnotations(kept, newText.length);
  return { annotations: result, dropped: annotations.length - result.length };
}
