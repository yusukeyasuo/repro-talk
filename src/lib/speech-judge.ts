/**
 * 「ワードスピーチ」（お題の日本語ワードを、30〜60秒の英語スピーチに織り込む練習）の
 * 純粋ロジック。React / DB に依存しないのでテスト対象（外部依存のないロジックだけを
 * tests に置く方針）。
 *
 * 判定の型・色は瞬間英作文の添削（composition-judge）と揃える。rating の enum と
 * ratingMeta（Great/Good/Bad の色）はそこから再利用する（重複させない）。
 */

import { ratingMeta, type JudgeRating } from './composition-judge.ts';

export { ratingMeta, type JudgeRating };

/** スピーチとして送るのに最低限ほしい文字数。空白だけ・一言だけは送らせない。 */
export const MIN_SPEECH_LENGTH = 10;

/** AI が返す1ワードぶんの使用判定。target_words と同じ順で全ワードぶん返る。 */
export type WordUsage = {
  word: string;
  used: boolean;
  comment_ja: string;
};

/** ワードスピーチの採点結果。/api/ai/monologue-speech-judge の Zod schema と一致させる。 */
export type SpeechJudgeResult = {
  rating: JudgeRating;
  feedback_ja: string;
  corrected: string;
  word_usage: WordUsage[];
  alternatives: { en: string; note_ja: string }[];
};

/**
 * 「採点してもらう」ボタンの disabled 判定。空白だけ・短すぎる入力は送らせない
 * （30〜60秒のスピーチのはずなので、一言だけで採点に回さない）。
 */
export function canSubmitSpeech(text: string): boolean {
  return text.trim().length >= MIN_SPEECH_LENGTH;
}

/** 使えたワードの数と総数を数える（結果画面の「n / m 個 使えました」用）。 */
export function summarizeWordUsage(usage: { used: boolean }[]): {
  used: number;
  total: number;
} {
  return {
    used: usage.filter((u) => u.used).length,
    total: usage.length,
  };
}
