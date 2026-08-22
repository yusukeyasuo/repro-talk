import { NextResponse } from 'next/server';
import * as z from 'zod';

import { NATURALIZE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const NaturalizeResult = z.object({
  naturalized: z.string().describe('ネイティブが自然に言う英語に整えた本文だけ（前置き・引用符・解説なし）'),
  note_ja: z.string().describe('主な直しどころを日本語で1〜2文。直しが無ければその旨'),
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

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== 'string' || !text.trim()) {
    return badRequest('本文が空です');
  }
  if (text.length > 4000) {
    return badRequest('本文が長すぎます。短く区切ってください。');
  }
  const noteRaw = (body as { note?: unknown })?.note;
  const note = typeof noteRaw === 'string' ? noteRaw.trim() : '';

  try {
    const result = await runStructured({
      system: NATURALIZE_SYSTEM_PROMPT,
      schema: NaturalizeResult,
      effort: 'medium',
      maxTokens: 4000,
      user: [
        '以下の英文を、意味を保ったままネイティブが自然に言う英語へ整えてください。',
        note ? `\n学習者が言いたいこと（参考・日本語）: ${note}` : '',
        '',
        '<text>',
        text,
        '</text>',
      ].join('\n'),
    });

    return NextResponse.json({
      naturalized: result.naturalized,
      note_ja: result.note_ja,
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
