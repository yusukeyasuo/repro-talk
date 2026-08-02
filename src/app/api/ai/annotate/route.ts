import { NextResponse } from 'next/server';
import * as z from 'zod';

import { PHONETICS_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { getCurrentUser } from '@/lib/supabase/server';
import { ANNOTATION_TYPES, normalizeAnnotations } from '@/types/annotation';

export const maxDuration = 120;

const AnnotateResult = z.object({
  translation_ja: z.string().describe('スクリプト全体の自然な日本語訳'),
  annotations: z.array(
    z.object({
      type: z.enum(ANNOTATION_TYPES),
      start: z.number().int().describe('スクリプト文字列の0起点の開始インデックス'),
      end: z.number().int().describe('排他の終了インデックス'),
      surface: z.string().describe('reduction のときの実際の音。それ以外は空文字'),
      note: z.string().describe('日本語の一言解説。不要なら空文字'),
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
      system: PHONETICS_SYSTEM_PROMPT,
      schema: AnnotateResult,
      effort: 'high',
      user: [
        '以下のスクリプトを解析してください。文字インデックスはこの文字列そのものに対する 0 起点の位置です。',
        '',
        '<script>',
        transcript,
        '</script>',
      ].join('\n'),
    });

    return NextResponse.json({
      translation_ja: result.translation_ja,
      // AI がインデックスをずらすことがあるので必ず正規化してから返す
      annotations: normalizeAnnotations(result.annotations, transcript.length),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
