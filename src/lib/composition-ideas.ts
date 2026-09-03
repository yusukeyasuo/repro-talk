/**
 * 瞬間英作文の「応用練習」で、AI に渡す材料を組み立てるロジック。
 *
 * 組み合わせる2〜3文を選ぶのは**サーバ側**で、AI にコース全文を渡して選ばせない。
 * 選ばせると前の方の文・似た文ばかりを拾い、コースの後半がいつまでも練習対象に
 * ならないため。シャッフルした池を順に食い潰す形にして、池を使い切るまで同じ文が
 * 2度出ないようにする（＝コース全体が均等に回る）。
 */

export type CompositionSeed = { id: string; ja: string; en: string };

/** AI へ渡す1問ぶんの材料。group は返答を対応づけるための1起点の番号。 */
export type IdeaSeedGroup = { group: number; items: CompositionSeed[] };

/** AI が作った応用文の候補。sourceIds は元にした例文（採否の判断材料として画面に出す）。 */
export type CompositionIdea = {
  ja: string;
  en: string;
  whyJa: string;
  sourceIds: string[];
};

/** Fisher-Yates。順番の偏りを避けるためだけなので決定性は要らない（テストでは rng を差す）。 */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 例文の池から、1問ぶん2〜3文の束を count 個作る。
 *
 * - 2文未満のコースでは組み合わせようがないので空を返す（呼び出し側で弾く）。
 * - 池を使い切ったらシャッフルし直して続ける。束の中で同じ文は重複させない。
 * - 池が2件しかなければ、束は常に2文になる。
 */
export function buildIdeaSeedGroups(
  compositions: CompositionSeed[],
  count: number,
  rng: () => number = Math.random,
): IdeaSeedGroup[] {
  if (compositions.length < 2 || count <= 0) return [];

  const maxSize = Math.min(3, compositions.length);
  let pool = shuffle(compositions, rng);
  let cursor = 0;

  const groups: IdeaSeedGroup[] = [];
  for (let n = 0; n < count; n += 1) {
    const size = maxSize === 2 ? 2 : 2 + (rng() < 0.5 ? 0 : 1);
    const items: CompositionSeed[] = [];
    const used = new Set<string>();

    while (items.length < size) {
      if (cursor >= pool.length) {
        // 池を使い切った。切り直して続ける（同じ束に同じ文を入れないよう used で弾く）
        pool = shuffle(compositions, rng);
        cursor = 0;
      }
      const next = pool[cursor];
      cursor += 1;
      if (used.has(next.id)) continue;
      used.add(next.id);
      items.push(next);
    }

    groups.push({ group: n + 1, items });
  }

  return groups;
}

/** 照合キー。表記のゆれ（大文字小文字・記号・空白）を畳んで文字と数字だけ残す。 */
export function normalizeCompositionKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * コースに既にある例文と重なる候補、および候補どうしの重複を落とす。
 * 日本語・英語のどちらかが一致すれば重複とみなす（片方だけ言い換えたものを通さない）。
 *
 * プロンプトでも避けさせているが言い切れないので最後にここで落とす。落とすのは
 * **畳んだうえで一致するもの**だけ。似ているだけのものは残して、採否は本人に委ねる。
 */
export function dedupeCompositionIdeas(
  ideas: CompositionIdea[],
  existing: { ja: string; en: string }[],
): CompositionIdea[] {
  const seen = new Set<string>();
  const remember = (value: string) => {
    const key = normalizeCompositionKey(value);
    if (key) seen.add(key);
  };

  for (const row of existing) {
    remember(row.ja);
    remember(row.en);
  }

  const kept: CompositionIdea[] = [];
  for (const idea of ideas) {
    const ja = idea.ja.trim();
    const en = idea.en.trim();
    // 片方でも欠けていると登録できない（importCompositions も両方必須）
    if (!ja || !en) continue;

    const jaKey = normalizeCompositionKey(ja);
    const enKey = normalizeCompositionKey(en);
    if (!jaKey || !enKey) continue;
    if (seen.has(jaKey) || seen.has(enKey)) continue;

    seen.add(jaKey);
    seen.add(enKey);
    kept.push({ ja, en, whyJa: idea.whyJa.trim(), sourceIds: idea.sourceIds });
  }

  return kept;
}
