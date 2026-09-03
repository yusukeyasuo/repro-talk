import { NextResponse } from 'next/server';
import * as z from 'zod';

import { COMPOSITION_IDEAS_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import {
  buildIdeaSeedGroups,
  dedupeCompositionIdeas,
  type CompositionSeed,
} from '@/lib/composition-ideas';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

// 1問ずつ作るのではなく1回でまとめて作らせる。20問 × effort:'high' は他の AI 導線
// （120秒）に収まらないことがあるので、この経路だけ長めに取る。
export const maxDuration = 300;

/** UI のトグルと合わせる。ここに無い件数は受け付けない。 */
const COUNTS = [5, 10, 20];
/**
 * 非ストリーミングで投げられる max_tokens の上限。SDK は max_tokens から所要時間を
 * 見積もり、10分を超える見込みだと**リクエストを投げる前に**例外にする
 * （`60 * 60 * max_tokens / 128000 > 600` 秒 → 21,333 が境目）。
 * `runStructured()` は非ストリーミングなので、ここを超える値は渡せない。
 */
const MAX_TOKENS_NONSTREAMING = 20000;
const MAX_SITUATION_LENGTH = 200;
/** 出し直しで積み上がる「もう見た候補」の上限。20件を数周ぶん。 */
const MAX_AVOID = 80;

const CompositionIdeas = z.object({
  ideas: z.array(
    z.object({
      group: z.number().describe('元にした group の番号。渡された番号をそのまま返す'),
      ja: z.string().describe('応用問題の日本語1文'),
      en: z.string().describe('その答えの英語1文'),
      why_ja: z.string().describe('どの型をどう組み替えたか。日本語で一言'),
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

  const { courseId, count, situation, avoid } = (body ?? {}) as {
    courseId?: unknown;
    count?: unknown;
    situation?: unknown;
    avoid?: unknown;
  };

  if (typeof courseId !== 'string' || !courseId) return badRequest('コースが指定されていません');
  if (typeof count !== 'number' || !COUNTS.includes(count)) return badRequest('件数が不正です');

  const scene = typeof situation === 'string' ? situation.trim() : '';
  if (scene.length > MAX_SITUATION_LENGTH) {
    return badRequest(`場面は ${MAX_SITUATION_LENGTH} 文字までで書いてください`);
  }

  const seenJa = Array.isArray(avoid)
    ? avoid
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, MAX_AVOID)
        .map((item) => item.trim().slice(0, 200))
    : [];

  const supabase = await createClient();

  // 材料はクライアントに言われるまま使わずサーバで引く（RLS 越しに読めなければ他人のコース）。
  const [{ data: course }, { data: rows }, { data: profile }] = await Promise.all([
    supabase.from('composition_courses').select('id, title').eq('id', courseId).maybeSingle(),
    supabase
      .from('compositions')
      .select('id, ja, en, source')
      .eq('course_id', courseId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('profiles').select('why_text').eq('id', user.id).maybeSingle(),
  ]);

  if (!course) return badRequest('コースが見つかりません');

  const all = (rows ?? []) as (CompositionSeed & { source: string })[];
  // 応用文を材料にすると AI が自分の出力を再加工していくことになり、コースの型から
  // どんどん離れる。ネタ元は本人が入れた例文（source='manual'）だけに限る。
  const seeds = all.filter((row) => row.source !== 'ai');
  if (seeds.length < 2) {
    return badRequest('応用を作るには、自分で入れた例文が2件以上必要です');
  }

  const groups = buildIdeaSeedGroups(seeds, count);
  const groupsBlock = groups
    .map(
      (group) =>
        `<group number="${group.group}">\n` +
        group.items.map((item) => `- ${item.ja} | ${item.en}`).join('\n') +
        `\n</group>`,
    )
    .join('\n');

  // 既に作った応用文と、この面で見せ終えた候補。プロンプト側でも避けさせる。
  const avoidBlock = [...all.filter((row) => row.source === 'ai').map((row) => row.ja), ...seenJa]
    .slice(-MAX_AVOID)
    .join('\n');

  const why = (profile as { why_text: string | null } | null)?.why_text?.trim() ?? '';

  try {
    const result = await runStructured({
      system: COMPOSITION_IDEAS_SYSTEM_PROMPT,
      schema: CompositionIdeas,
      // 答えの英語がそのまま「正解」として読み上げられるので、生成の深さは削らない。
      effort: 'high',
      maxTokens: count >= 20 ? MAX_TOKENS_NONSTREAMING : 16000,
      user: [
        `<course_title>${course.title}</course_title>`,
        why ? `<why>\n${why}\n</why>` : '',
        scene ? `<situation>\n${scene}\n</situation>` : '',
        `<groups>\n${groupsBlock}\n</groups>`,
        avoidBlock ? `<avoid>\n${avoidBlock}\n</avoid>` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    const byGroup = new Map(groups.map((group) => [group.group, group]));
    const ideas = dedupeCompositionIdeas(
      result.ideas.map((idea) => ({
        ja: idea.ja,
        en: idea.en,
        whyJa: idea.why_ja,
        sourceIds: byGroup.get(idea.group)?.items.map((item) => item.id) ?? [],
      })),
      all,
    ).slice(0, count);

    // 元にした文は採否の判断材料（型が本当に残っているか）なので、本文ごと返す。
    const seedById = new Map(seeds.map((seed) => [seed.id, { ja: seed.ja, en: seed.en }]));
    return NextResponse.json({
      ideas: ideas.map((idea) => ({
        ja: idea.ja,
        en: idea.en,
        whyJa: idea.whyJa,
        sources: idea.sourceIds
          .map((id) => seedById.get(id))
          .filter((seed) => seed !== undefined),
      })),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
