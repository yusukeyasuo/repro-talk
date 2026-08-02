import { NextResponse } from 'next/server';
import * as z from 'zod';

import { EXPLAIN_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const ExplainResult = z.object({
  headline: z.string().describe('この表現を一言で言うと何か。20字程度'),
  explanation: z.string().describe('文脈での意味と、一般的な使われ方。Markdown可'),
  examples: z
    .array(
      z.object({
        en: z.string(),
        ja: z.string(),
        when: z.string().describe('どんな気持ち・場面で使うか。日本語で一言'),
      }),
    )
    .describe('独り言でそのまま使える例文を3つ'),
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

  const { transcript, selection, question } = (body ?? {}) as {
    transcript?: unknown;
    selection?: unknown;
    question?: unknown;
  };

  if (typeof question !== 'string' || !question.trim()) {
    return badRequest('質問が空です');
  }

  const contextLines = [
    typeof transcript === 'string' && transcript.trim()
      ? `<context>\n${transcript.slice(0, 4000)}\n</context>`
      : null,
    typeof selection === 'string' && selection.trim()
      ? `<selection>\n${selection.slice(0, 500)}\n</selection>`
      : null,
    `<question>\n${question.slice(0, 1000)}\n</question>`,
  ].filter(Boolean);

  try {
    const result = await runStructured({
      system: EXPLAIN_SYSTEM_PROMPT,
      schema: ExplainResult,
      effort: 'high',
      user: contextLines.join('\n\n'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
