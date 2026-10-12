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

/** 自然にした文章の1文。ja は瞬間英作文の問題文としてそのまま使える訳。 */
export type CorrectedSentence = {
  en: string;
  ja: string;
};

/** 添削結果。/api/ai/monologue-writing-judge の Zod schema と一致させる。 */
export type WritingJudgeResult = {
  rating: JudgeRating;
  feedback_ja: string;
  /**
   * 自然にした文章を文ごとに。全文は joinCorrected で組み立てる（全文と文ごとを
   * 別々に持つと食い違うので、元は1つにする）。瞬間英作文への登録はこの単位。
   */
  corrected_sentences: CorrectedSentence[];
  corrections: WritingCorrection[];
  alternatives: { en: string; meaning_ja: string; note_ja: string }[];
};

/** 画面と読み上げに出す全文。 */
export function joinCorrected(sentences: CorrectedSentence[]): string {
  return sentences
    .map((s) => s.en.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * AI の添削結果が欠けていないかの検品。スキーマ（Zod）は型しか見ないので、
 * 出力が途中で切れて "x" や空文字で閉じられた結果も通ってしまう。
 * - 自然にした文章は本文全体の書き直しなので、つなげて送信の最低文字数を下回らない
 * - 文ごとの英語と日本語訳がどちらも空でない（訳はそのまま瞬間英作文の問題文になる）
 * - feedback_ja が空でない
 * - corrections / alternatives に空の英語が混じっていない
 * 満たさないものは画面に出さず、もう一度試してもらう（添削は「正解」として読み上げられる）。
 */
export function isCompleteWritingJudge(
  result: Pick<
    WritingJudgeResult,
    'feedback_ja' | 'corrected_sentences' | 'corrections' | 'alternatives'
  >,
): boolean {
  return (
    result.corrected_sentences.length > 0 &&
    result.corrected_sentences.every((s) => s.en.trim() !== '' && s.ja.trim() !== '') &&
    joinCorrected(result.corrected_sentences).length >= MIN_SPEECH_LENGTH &&
    result.feedback_ja.trim() !== '' &&
    result.corrections.every((c) => c.after.trim() !== '') &&
    result.alternatives.every((a) => a.en.trim() !== '')
  );
}

/** コース名に入れるお題の上限。一覧のカードで読める長さに収める。 */
const COURSE_TOPIC_MAX = 80;

/**
 * 独り言の「書く」から登録するときのコース名。1回の添削につき1コース作るので、
 * 一覧で「いつ・何の話か」が分かるよう日付とお題を入れる（例「独り言 10/12 好きな食べ物」）。
 * dateIso は JST の YYYY-MM-DD（端末の時刻に依らせないためサーバで決める）。
 */
export function monologueCourseTitle(dateIso: string, topicJa: string | null): string {
  const [, m, d] = dateIso.split('-').map(Number);
  const topic = (topicJa ?? '').trim().slice(0, COURSE_TOPIC_MAX);
  return topic ? `独り言 ${m}/${d} ${topic}` : `独り言 ${m}/${d}`;
}
