/**
 * 瞬間英作文「AI添削モード」の純粋ロジック。React / DB に依存しないので
 * テスト対象（外部依存のないロジックだけを tests に置く方針）。
 *
 * 判定の型は /api/ai/composition-judge の Zod schema と一致させる。
 */

export type JudgeRating = 'great' | 'good' | 'bad';

export type JudgeResult = {
  rating: JudgeRating;
  feedback_ja: string;
  corrected: string;
  alternatives: { en: string; note_ja: string }[];
};

/** 判定バッジのラベルと色（light+dark、badge.tsx の dark: イディオムに合わせる）。 */
export const RATING_META: Record<JudgeRating, { label: string; badgeClass: string }> = {
  great: {
    label: 'Great（自然）',
    badgeClass:
      'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  good: {
    label: 'Good（通じる）',
    badgeClass:
      'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  bad: {
    label: 'Bad（通じない）',
    badgeClass:
      'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  },
};

/**
 * 判定値のメタ情報を返す。rating は AI が返す enum なので、想定外の値でも
 * 空バッジを描かないよう good にフォールバックする（最終防波堤）。
 */
export function ratingMeta(rating: string): { label: string; badgeClass: string } {
  return RATING_META[rating as JudgeRating] ?? RATING_META.good;
}

/** 送信ボタンの disabled 判定。空白だけの入力は送らせない。 */
export function canSubmitAttempt(attempt: string): boolean {
  return attempt.trim().length > 0;
}
