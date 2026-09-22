import { NextResponse } from 'next/server';
import * as z from 'zod';

import { SPEECH_WORDS_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { runStructured } from '@/lib/ai/run';
import { aiErrorResponse, badRequest, unauthorized } from '@/lib/api';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const maxDuration = 120;

const DEFAULT_COUNT = 3;
const MIN_COUNT = 1;
const MAX_COUNT = 6;
/** AI に渡す材料の上限。全文をぶちまけず、シャッフルして頭から30文だけ渡す。 */
const MAX_SEEDS = 30;
/** 出し直しで積み上がる「もう見たワード」の上限。 */
const MAX_AVOID = 60;

const SpeechWords = z.object({
  words: z.array(
    z.object({
      ja: z.string().describe('お題にする日本語の言葉（単語か短いフレーズ）。英語訳は付けない'),
      source_ja: z.string().describe('その言葉を取り出した元の日本語の例文'),
    }),
  ),
});

type Seed = { ja: string; en: string };

/** Fisher-Yates。材料の偏り（前の方の文ばかり）を避けるためだけなので決定性は要らない。 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('リクエストの形式が不正です');
  }

  const { courseId, count, avoid } = (body ?? {}) as {
    courseId?: unknown;
    count?: unknown;
    avoid?: unknown;
  };

  if (typeof courseId !== 'string' || !courseId) return badRequest('コースが指定されていません');

  const wanted =
    typeof count === 'number' && Number.isFinite(count)
      ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(count)))
      : DEFAULT_COUNT;

  const seenJa = Array.isArray(avoid)
    ? avoid
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .slice(0, MAX_AVOID)
        .map((item) => item.trim().slice(0, 100))
    : [];

  const supabase = await createClient();

  // 材料はクライアントに言われるまま使わずサーバで引く（RLS 越しに読めなければ他人のコース）。
  const [{ data: course }, { data: rows }] = await Promise.all([
    supabase.from('composition_courses').select('id, title').eq('id', courseId).maybeSingle(),
    supabase
      .from('compositions')
      .select('ja, en, source')
      .eq('course_id', courseId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (!course) return badRequest('コースが見つかりません');

  const all = (rows ?? []) as (Seed & { source: string })[];
  // ネタ元は本人が入れた例文（source='manual'）だけ。応用文を材料にすると型から離れる。
  const seeds = all.filter((row) => row.source !== 'ai');
  if (seeds.length < 2) {
    return badRequest('お題を作るには、自分で入れた例文が2件以上必要です');
  }

  const sampled = shuffle(seeds).slice(0, MAX_SEEDS);
  const seedsBlock = sampled.map((seed) => `- ${seed.ja} | ${seed.en}`).join('\n');
  const avoidBlock = seenJa.join('\n');

  try {
    const result = await runStructured({
      system: SPEECH_WORDS_SYSTEM_PROMPT,
      schema: SpeechWords,
      // ワードを選ぶだけの抽出系タスクなので medium。
      effort: 'medium',
      maxTokens: 8000,
      user: [
        `<course_title>${course.title}</course_title>`,
        `<count>${wanted}</count>`,
        `<seeds>\n${seedsBlock}\n</seeds>`,
        avoidBlock ? `<avoid>\n${avoidBlock}\n</avoid>` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    // 件数超過だけ落とす（不足はそのまま返す。英訳は付けない設計なので中身は素通し）。
    return NextResponse.json({ words: result.words.slice(0, wanted) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
