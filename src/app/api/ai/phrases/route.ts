import { NextResponse } from 'next/server';
import * as z from 'zod';

import { PHRASE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const PhraseResult = z.object({
  phrases: z.array(
    z.object({
      text: z.string().describe('そのまま口から出せる長さのかたまり'),
      meaning_ja: z.string(),
      why: z.string().describe('独り言でどう応用できるか。日本語で一言'),
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

  const transcript = (body as { transcript?: unknown })?.transcript;
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return badRequest('スクリプトが空です');
  }

  try {
    const result = await runStructured({
      system: PHRASE_SYSTEM_PROMPT,
      schema: PhraseResult,
      effort: 'medium',
      maxTokens: 8000,
      user: `<script>\n${transcript.slice(0, 4000)}\n</script>`,
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
