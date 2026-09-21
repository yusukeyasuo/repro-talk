import { NextResponse } from 'next/server';
import * as z from 'zod';

import { COMPOSITION_JUDGE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const JudgeResult = z.object({
  rating: z
    .enum(['great', 'good', 'bad'])
    .describe('学習者の英文そのものの自然さ。great=直す点なし / good=通じるが不自然 / bad=通じない'),
  feedback_ja: z
    .string()
    .describe('良かった点に触れてから直す点を具体的に。日本語で1〜3文。社交辞令は書かない'),
  corrected: z
    .string()
    .describe('学習者の語・構文を残して最小限だけ直した自然な英文1つ。前置き・引用符・解説は入れない'),
  alternatives: z
    .array(
      z.object({
        en: z.string().describe('corrected と切り口を変えた別の自然な言い回し。話し言葉レベル'),
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

  const { ja, en, attempt } = (body ?? {}) as {
    ja?: unknown;
    en?: unknown;
    attempt?: unknown;
  };

  if (typeof ja !== 'string' || !ja.trim()) return badRequest('日本語のお題が必要です');
  if (typeof attempt !== 'string' || !attempt.trim()) {
    return badRequest('あなたの英文を入力してください');
  }

  // 参考解答は任意。文字列でなければ無いものとして扱う。
  const reference = typeof en === 'string' ? en.trim() : '';
  if (ja.length > 1000 || attempt.length > 1000 || reference.length > 1000) {
    return badRequest('文が長すぎます');
  }

  try {
    const result = await runStructured({
      system: COMPOSITION_JUDGE_SYSTEM_PROMPT,
      schema: JudgeResult,
      // 評価＋添削＋別解は誤りが学習者を害する評価タスク。出力は読み上げで「正解」として流れる。
      effort: 'high',
      user: [
        `<japanese>\n${ja.trim()}\n</japanese>`,
        reference ? `<reference_answer>\n${reference}\n</reference_answer>` : '',
        `<learner_attempt>\n${attempt.trim()}\n</learner_attempt>`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
