import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod';

import { anthropic, MODEL } from './client';

/** 安全性分類器に弾かれた。ユーザーには「別の言い方で試して」と伝える。 */
export class AiRefusalError extends Error {
  constructor(readonly category: string | null) {
    super('AI がこのリクエストへの応答を控えました');
    this.name = 'AiRefusalError';
  }
}

export class AiParseError extends Error {
  constructor() {
    super('AI の出力を解析できませんでした');
    this.name = 'AiParseError';
  }
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export async function runStructured<S extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  /** 深さとコストの唯一のレバー。まず high、evalして落とせるか見る。 */
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const message = await anthropic.beta.messages.parse({
    model: MODEL,
    // thinking は省略で adaptive がON。max_tokens は思考＋本文の合計上限なので余裕を持たせる。
    max_tokens: opts.maxTokens ?? 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [
      // システムプロンプトは安定させてキャッシュを効かせる
      { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      effort: opts.effort ?? 'high',
      format: betaZodOutputFormat(opts.schema),
    },
    messages: [{ role: 'user', content: opts.user }],
  });

  // content を読む前に必ず refusal を分岐する
  if (message.stop_reason === 'refusal') {
    throw new AiRefusalError(message.stop_details?.category ?? null);
  }

  const parsed = message.parsed_output;
  if (parsed == null) throw new AiParseError();
  return parsed as z.infer<S>;
}
