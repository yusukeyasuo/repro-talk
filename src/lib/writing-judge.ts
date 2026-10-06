/**
 * 独り言「書く」モード（お題について英語を書き、AI に添削してもらう）の純粋ロジック。
 * React / DB に依存しないのでテスト対象（外部依存のないロジックだけを tests に置く方針）。
 *
 * 判定の色・送信可否はワードスピーチ（speech-judge）と揃える（重複させない）。
 */

import { canSubmitSpeech, MIN_SPEECH_LENGTH, ratingMeta, type JudgeRating } from './speech-judge.ts';

export { canSubmitSpeech, MIN_SPEECH_LENGTH, ratingMeta, type JudgeRating };

/** 1箇所ぶんの直し。日本語のまま書いた部分（＝言えなかった部分）もここに入る。 */
export type WritingCorrection = {
  before: string;
  after: string;
  note_ja: string;
};

/** 添削結果。/api/ai/monologue-writing-judge の Zod schema と一致させる。 */
export type WritingJudgeResult = {
  rating: JudgeRating;
  feedback_ja: string;
  corrected: string;
  corrections: WritingCorrection[];
  alternatives: { en: string; meaning_ja: string; note_ja: string }[];
};

/**
 * AI の添削結果が欠けていないかの検品。スキーマ（Zod）は型しか見ないので、
 * 出力が途中で切れて "x" や空文字で閉じられた結果も通ってしまう。
 * - corrected は本文全体の書き直しなので、送信の最低文字数を下回らない
 * - feedback_ja が空でない
 * - corrections / alternatives に空の英語が混じっていない
 * 満たさないものは画面に出さず、もう一度試してもらう（添削は「正解」として読み上げられる）。
 */
export function isCompleteWritingJudge(
  result: Pick<WritingJudgeResult, 'feedback_ja' | 'corrected' | 'corrections' | 'alternatives'>,
): boolean {
  return (
    result.corrected.trim().length >= MIN_SPEECH_LENGTH &&
    result.feedback_ja.trim() !== '' &&
    result.corrections.every((c) => c.after.trim() !== '') &&
    result.alternatives.every((a) => a.en.trim() !== '')
  );
}
