import { NextResponse } from 'next/server';
import * as z from 'zod';

import { TOPIC_IDEAS_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { dedupeTopicSuggestions } from '@/lib/topic-suggestions';

export const maxDuration = 120;

/** UI のトグルと合わせる。ここに無い件数は受け付けない。 */
const COUNTS = [10, 20, 30];
const MAX_DIRECTION_LENGTH = 200;
/** 出し直しで積み上がる「もう見た候補」の上限。30件を数周ぶん。 */
const MAX_AVOID = 120;

const TopicIdeas = z.object({
  topics: z.array(
    z.object({
      title_en: z.string().describe('お題の英語。短い名詞句か What / How で始まる句'),
      title_ja: z.string().describe('同じ内容の日本語。20字程度'),
      why_ja: z.string().describe('このお題で何を話せるか。日本語で一言'),
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

  const { direction, count, avoid } = (body ?? {}) as {
    direction?: unknown;
    count?: unknown;
    avoid?: unknown;
  };

  const trimmed = typeof direction === 'string' ? direction.trim() : '';
  if (!trimmed) return badRequest('どんな方向のお題が欲しいかを書いてください');
  if (trimmed.length > MAX_DIRECTION_LENGTH) {
    return badRequest(`方向性は ${MAX_DIRECTION_LENGTH} 文字までで書いてください`);
  }
  if (typeof count !== 'number' || !COUNTS.includes(count)) {
    return badRequest('件数が不正です');
  }

  // 出し直しのときにクライアントが積んでくる「もう見た候補」の英語見出し
  const seenTitles = Array.isArray(avoid)
    ? avoid
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, MAX_AVOID)
        .map((item) => item.trim().slice(0, 120))
    : [];

  // 既存のお題はクライアントに言われるまま使わずサーバで引く。
  // RLS が「共通シード＋自分のお題」だけ返すので、そのまま重複判定に使える。
  const supabase = await createClient();
  const { data } = await supabase.from('monologue_topics').select('title_en, title_ja');
  const existing = [
    ...(data ?? []).map((topic) => ({ titleEn: topic.title_en, titleJa: topic.title_ja })),
    ...seenTitles.map((titleEn) => ({ titleEn, titleJa: '' })),
  ];

  const existingBlock = existing
    .map((topic) => (topic.titleJa ? `${topic.titleEn} | ${topic.titleJa}` : topic.titleEn))
    .join('\n');

  try {
    const result = await runStructured({
      system: TOPIC_IDEAS_SYSTEM_PROMPT,
      schema: TopicIdeas,
      effort: 'medium',
      // 30件だと本文だけで嵩むので、件数に合わせて上限を上げる（思考ぶんも含む合計）
      maxTokens: count >= 20 ? 16000 : 8000,
      user: [
        `<direction>\n${trimmed}\n</direction>`,
        `<count>${count}</count>`,
        `<existing_topics>\n${existingBlock}\n</existing_topics>`,
      ].join('\n\n'),
    });

    // プロンプトで避けさせたうえで、最後にサーバでも重複を落とす（要求件数を下回りうる）
    const topics = dedupeTopicSuggestions(
      result.topics.map((topic) => ({
        titleEn: topic.title_en,
        titleJa: topic.title_ja,
        whyJa: topic.why_ja,
      })),
      existing,
    ).slice(0, count);

    return NextResponse.json({ topics });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
