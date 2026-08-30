/**
 * AI が出した独り言のお題候補を、登録できる形に整えるロジック。
 *
 * 既にあるお題（共通シード＋自分のお題）と同じものが混ざると、選ぶ手間だけが増えて
 * お題一覧にも同じ行が二度並ぶ。プロンプトでも「重ならないように」と言ってはいるが、
 * 言い切れないのでサーバ側でも落とす。
 *
 * 落とすのは**表記のゆれを畳んだうえで一致するもの**だけにする。似ているだけのものを
 * 機械が捨てると、本人が見て選ぶ余地がなくなる（採否の判断は本人に残す）。
 */

export type TopicSuggestion = { titleEn: string; titleJa: string; whyJa: string };

/** 照合キー。大文字小文字・記号・空白の違いを無視するため、文字と数字だけ残す。 */
export function normalizeTopicKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * 既存のお題と重なる候補、および候補どうしの重複を落とす。
 * 英語・日本語のどちらかが一致すれば重複とみなす（片方だけ言い換えた候補を通さない）。
 * existing の titleJa は空でもよい（出し直しのときは英語だけ渡ってくる）。
 */
export function dedupeTopicSuggestions(
  suggestions: TopicSuggestion[],
  existing: { titleEn: string; titleJa: string }[],
): TopicSuggestion[] {
  const seen = new Set<string>();
  const remember = (value: string) => {
    const key = normalizeTopicKey(value);
    if (key) seen.add(key);
  };

  for (const topic of existing) {
    remember(topic.titleEn);
    remember(topic.titleJa);
  }

  const kept: TopicSuggestion[] = [];
  for (const suggestion of suggestions) {
    const titleEn = suggestion.titleEn.trim();
    const titleJa = suggestion.titleJa.trim();
    // 片方でも欠けていると登録できない（importCustomTopics も両方必須）
    if (!titleEn || !titleJa) continue;

    const enKey = normalizeTopicKey(titleEn);
    const jaKey = normalizeTopicKey(titleJa);
    if (!enKey || !jaKey) continue;
    if (seen.has(enKey) || seen.has(jaKey)) continue;

    seen.add(enKey);
    seen.add(jaKey);
    kept.push({ titleEn, titleJa, whyJa: suggestion.whyJa.trim() });
  }

  return kept;
}
