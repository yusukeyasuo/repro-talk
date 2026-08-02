import { NextResponse } from 'next/server';
import * as z from 'zod';

import { MONOLOGUE_FEEDBACK_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const FeedbackResult = z.object({
  suggestions: z.array(
    z.object({
      text: z.string().describe('そのまま口に出せる自然な英語'),
      meaning_ja: z.string().describe('元のメモに対応する日本語'),
      examples: z.array(z.string()).describe('真似できる例文を2つ'),
    }),
  ),
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

  const { ja_memo: jaMemo, topic } = (body ?? {}) as {
    ja_memo?: unknown;
    topic?: unknown;
  };

  if (typeof jaMemo !== 'string' || !jaMemo.trim()) {
    return badRequest('メモが空です');
  }

  const parts = [
    typeof topic === 'string' && topic.trim()
      ? `<topic>${topic.slice(0, 200)}</topic>`
      : null,
    `<memo>\n${jaMemo.slice(0, 2000)}\n</memo>`,
  ].filter(Boolean);

  try {
    const result = await runStructured({
      system: MONOLOGUE_FEEDBACK_SYSTEM_PROMPT,
      schema: FeedbackResult,
      effort: 'medium',
      maxTokens: 8000,
      user: parts.join('\n\n'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
