import { NextResponse } from 'next/server';
import * as z from 'zod';

import { MONOLOGUE_WRITING_JUDGE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { AiParseError, runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';
import { isCompleteWritingJudge } from '@/lib/writing-judge';

// 添削は effort high で全文の書き直しまで出すので、既定（120秒）に収まらないことがある
export const maxDuration = 300;

/** 独り言1回ぶんの文章は長くはならない。異常に長い入力は弾く。 */
const MAX_TEXT_LENGTH = 4000;
const MAX_TOPIC_LENGTH = 200;
/**
 * max_tokens は思考＋本文の合計上限。ワードスピーチと違ってお題ワードの判定が無いぶん
 * 出力は小さい。非ストリーミングの上限（21,333）は超えない。
 */
const MAX_TOKENS = 16000;

const WritingJudgeResult = z.object({
  rating: z
    .enum(['great', 'good', 'bad'])
    .describe('英語で書かれた部分の自然さ。great=ほぼ直す点なし / good=通じるが不自然 / bad=通じない'),
  feedback_ja: z
    .string()
    .describe('良かった点に触れてから直すとよい点を具体的に。日本語で2〜4文。萎縮させない・社交辞令は書かない'),
  corrected: z
    .string()
    .describe('学習者の語・構文を残し、言いたかった意味を保ったまま自然な話し言葉にした全文。日本語の部分も英語にする。前置き・引用符・解説は入れない'),
  corrections: z
    .array(
      z.object({
        before: z.string().describe('学習者の文章から逐語コピーした短いかたまり（日本語のまま書かれた部分も含む）'),
        after: z.string().describe('直した英語'),
        note_ja: z.string().describe('なぜそう直すのかを日本語で一言'),
      }),
    )
    .describe('直した箇所を文章に出てくる順に最大6件。直す点が無ければ空'),
  alternatives: z
    .array(
      z.object({
        en: z.string().describe('この話題で次に使える自然な言い回し。独り言でそのまま口に出せる長さ'),
        meaning_ja: z.string().describe('その英語の意味を日本語で一言'),
        note_ja: z.string().describe('ニュアンスや使う場面を日本語で一言'),
      }),
    )
    .describe('別の自然な言い回しを2〜3個'),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('リクエストの形式が不正です');
  }

  const { topic, text } = (body ?? {}) as { topic?: unknown; text?: unknown };

  if (typeof text !== 'string' || !text.trim()) {
    return badRequest('文章を入力してください');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return badRequest('文章が長すぎます');
  }

  const topicLine = formatTopic(topic);

  try {
    const result = await runStructured({
      system: MONOLOGUE_WRITING_JUDGE_SYSTEM_PROMPT,
      schema: WritingJudgeResult,
      // 添削・書き直しは誤りが学習者を害する評価タスク。出力は読み上げで「正解」として流れる。
      effort: 'high',
      maxTokens: MAX_TOKENS,
      user: [
        topicLine ? `<topic>\n${topicLine}\n</topic>` : null,
        `<learner_text>\n${text.trim()}\n</learner_text>`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    // 型は合っていても中身が欠けた結果（"x" や空文字で閉じられたもの）は出さない
    if (!isCompleteWritingJudge(result)) throw new AiParseError();
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}

/** お題は { en, ja }。どちらか片方でもあれば渡す。 */
function formatTopic(topic: unknown): string | null {
  if (!topic || typeof topic !== 'object') return null;
  const { en, ja } = topic as { en?: unknown; ja?: unknown };
  const lines = [en, ja]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim().slice(0, MAX_TOPIC_LENGTH));
  return lines.length > 0 ? lines.join('\n') : null;
}
