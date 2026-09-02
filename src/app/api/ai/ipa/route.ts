import { NextResponse } from 'next/server';
import * as z from 'zod';

import { IPA_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { resolveAiPronunciations } from '@/lib/pronunciation-anchor';
import { getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const IpaResult = z.object({
  words: z.array(
    z.object({
      word: z.string().describe('スクリプトに出てくる語（綴りはそのまま・前後の記号は付けない）'),
      ipa: z.string().describe('その語の発音記号。IPA だけ（スラッシュ・角括弧なし）'),
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
  if (transcript.length > 4000) {
    return badRequest('スクリプトが長すぎます。30秒ぶん程度に区切ってください。');
  }

  try {
    const result = await runStructured({
      // 語ごとの読みを引く作業なので、注釈（annotate）ほど深く考えさせない
      effort: 'medium',
      system: IPA_SYSTEM_PROMPT,
      schema: IpaResult,
      user: [
        '以下のスクリプトに出てくる語を、出現順にすべて挙げて発音記号を付けてください。',
        '',
        '<script>',
        transcript,
        '</script>',
      ].join('\n'),
    });

    return NextResponse.json({
      // 語を出現順に突き合わせてオフセットを復元し、拾えなかった語は落とす
      pronunciations: resolveAiPronunciations(result.words, transcript),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
