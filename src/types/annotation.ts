/**
 * 発音マーキング。動画で紹介されている「紙に書き出してカラーペンで書き込む」記号を
 * そのままデータ化したもの。transcript の文字インデックス [start, end) を指す。
 */
export const ANNOTATION_TYPES = [
  'stress', // 強く発音する部分（山）
  'rise', // 音が上がるところ（矢印）
  'drop', // 発音しない音（×）— good morning の d
  'link', // リンキング／連結（cherry blossomS Survived）
  'flap_t', // フラップT（丸）— yet another が「イェラナザー」
  'reduction', // 短縮（going to → gonna）
  'swallow', // 飲み込む音（mountain → マウンтン）
] as const;

export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export type Annotation = {
  id: string;
  type: AnnotationType;
  /** transcript の文字インデックス（0起点） */
  start: number;
  /** 排他。start < end */
  end: number;
  /** reduction のときの実際の音。例: "gonna" */
  surface?: string;
  /** 任意のひとことメモ */
  note?: string;
};

type AnnotationMeta = {
  label: string;
  description: string;
  /** マーカーの色。Tailwind ではなく CSS 変数を避けて直接指定（SVG 描画で使うため） */
  color: string;
  /** ツールバーに出す記号 */
  glyph: string;
};

export const ANNOTATION_META: Record<AnnotationType, AnnotationMeta> = {
  stress: {
    label: '強勢',
    description: '強く発音する部分。上に山を描く。',
    color: '#e11d48',
    glyph: '⌃',
  },
  rise: {
    label: '上がる',
    description: '音が上がるところ。上向きの矢印。',
    color: '#f59e0b',
    glyph: '↗',
  },
  drop: {
    label: '脱落',
    description: '発音しない音。good morning の d のようにバツをつける。',
    color: '#64748b',
    glyph: '✕',
  },
  link: {
    label: '連結',
    description: '音がつながるところ。下に連結線を引く。',
    color: '#2563eb',
    glyph: '‿',
  },
  flap_t: {
    label: 'フラップT',
    description: '母音に挟まれた T がラ行の音に変わる。丸で囲む。',
    color: '#16a34a',
    glyph: '◯',
  },
  reduction: {
    label: '短縮',
    description: 'going to → gonna のように縮む。実際の音を書き添える。',
    color: '#9333ea',
    glyph: '≈',
  },
  swallow: {
    label: '飲み込む',
    description: 'mountain のように音を飲み込む。',
    color: '#0891b2',
    glyph: '⌄',
  },
};

/** 不正な範囲・重複 id を落として正規化する。AI の出力も手入力もここを通す。 */
export function normalizeAnnotations(
  input: unknown,
  transcriptLength: number,
): Annotation[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Annotation[] = [];

  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) continue;
    const a = raw as Partial<Annotation>;
    if (!a.type || !ANNOTATION_TYPES.includes(a.type)) continue;

    const start = Math.trunc(Number(a.start));
    const end = Math.trunc(Number(a.end));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const clampedStart = Math.max(0, Math.min(start, transcriptLength));
    const clampedEnd = Math.max(0, Math.min(end, transcriptLength));
    if (clampedEnd <= clampedStart) continue;

    let id = typeof a.id === 'string' && a.id ? a.id : crypto.randomUUID();
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);

    out.push({
      id,
      type: a.type,
      start: clampedStart,
      end: clampedEnd,
      ...(typeof a.surface === 'string' && a.surface ? { surface: a.surface } : {}),
      ...(typeof a.note === 'string' && a.note ? { note: a.note } : {}),
    });
  }

  return out.sort((x, y) => x.start - y.start || x.end - y.end);
}
