import { NextResponse } from 'next/server';
import * as z from 'zod';

import { MONOLOGUE_SPEECH_JUDGE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

/** お題ワードは多くて6個（speech-words の上限に合わせる）。 */
const MAX_WORDS = 6;
const MAX_WORD_LENGTH = 100;
/** 30〜60秒のスピーチなので長くはならない。異常に長い入力は弾く。 */
const MAX_SPEECH_LENGTH = 4000;

const SpeechJudgeResult = z.object({
  rating: z
    .enum(['great', 'good', 'bad'])
    .describe('スピーチの英語そのものの自然さ。great=ほぼ直す点なし / good=通じるが不自然 / bad=通じない'),
  feedback_ja: z
    .string()
    .describe('良かった点に触れてから直すとよい点を具体的に。日本語で2〜4文。萎縮させない・社交辞令は書かない'),
  corrected: z
    .string()
    .describe('学習者の語・構文を残し、言いたかった意味を保ったまま自然にしたスピーチ全文。前置き・引用符・解説は入れない'),
  word_usage: z
    .array(
      z.object({
        word: z.string().describe('お題の日本語ワード（渡されたものをそのまま返す）'),
        used: z.boolean().describe('その概念が英語で表現できていれば true。訳語一致でなくても寛容に付ける'),
        comment_ja: z.string().describe('どう表現できていたか／どう言えばよかったかを日本語で一言'),
      }),
    )
    .describe('お題のワードを渡された順に全て。過不足なく1ワード1件'),
  alternatives: z
    .array(
      z.object({
        en: z.string().describe('スピーチで使える別の自然な言い回し。話し言葉レベル'),
        note_ja: z.string().describe('その言い方のニュアンスや使う場面を日本語で一言'),
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

  const { words, speech } = (body ?? {}) as {
    words?: unknown;
    speech?: unknown;
  };

  const targetWords = Array.isArray(words)
    ? words
        .filter((w): w is string => typeof w === 'string' && w.trim() !== '')
        .slice(0, MAX_WORDS)
        .map((w) => w.trim().slice(0, MAX_WORD_LENGTH))
    : [];
  if (targetWords.length === 0) return badRequest('お題のワードがありません');

  if (typeof speech !== 'string' || !speech.trim()) {
    return badRequest('スピーチを入力してください');
  }
  if (speech.length > MAX_SPEECH_LENGTH) {
    return badRequest('スピーチが長すぎます');
  }

  try {
    const result = await runStructured({
      system: MONOLOGUE_SPEECH_JUDGE_SYSTEM_PROMPT,
      schema: SpeechJudgeResult,
      // 添削・書き直しは誤りが学習者を害する評価タスク。出力は読み上げで「正解」として流れる。
      effort: 'high',
      user: [
        `<target_words>\n${targetWords.join('\n')}\n</target_words>`,
        `<learner_speech>\n${speech.trim()}\n</learner_speech>`,
      ].join('\n\n'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
