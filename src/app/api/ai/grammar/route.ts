import { NextResponse } from 'next/server';
import * as z from 'zod';

import { GRAMMAR_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const GrammarResult = z.object({
  headline: z.string().describe('この文を組み立てるときの急所を一言で。25字程度'),
  build: z.string().describe('日本語からこの英語を組み立てる順番。2〜4文'),
  points: z
    .array(
      z.object({
        focus: z.string().describe('対象の箇所。英文から逐語コピーした短いかたまり'),
        label: z.string().describe('文法項目名を数語で（時制・冠詞・前置詞・語順など）'),
        detail: z.string().describe('この文でなぜそうなるか。日本語で1〜3文'),
      }),
    )
    .describe('判断が必要な箇所だけを2〜4個'),
  pitfalls: z
    .array(
      z.object({
        wrong: z.string().describe('日本語から直訳したときにやりがちな誤った英語'),
        why: z.string().describe('なぜ通じない・不自然なのか。日本語で1〜2文'),
      }),
    )
    .describe('明確なものが無ければ空配列にする。多くても2個'),
  variations: z
    .array(z.object({ en: z.string(), ja: z.string() }))
    .describe('同じ型を使った応用例文を2つ'),
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

  const { ja, en } = (body ?? {}) as { ja?: unknown; en?: unknown };

  if (typeof ja !== 'string' || !ja.trim() || typeof en !== 'string' || !en.trim()) {
    return badRequest('日本語と英語の両方が必要です');
  }
  if (ja.length > 1000 || en.length > 1000) {
    return badRequest('例文が長すぎます');
  }

  try {
    const result = await runStructured({
      system: GRAMMAR_SYSTEM_PROMPT,
      schema: GrammarResult,
      // 「なぜこの形になるか」の説明なので explain と同じ深さで回す。
      effort: 'high',
      user: [`<japanese>\n${ja.trim()}\n</japanese>`, `<english>\n${en.trim()}\n</english>`].join(
        '\n\n',
      ),
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
