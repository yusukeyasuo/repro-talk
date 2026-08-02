import Anthropic from '@anthropic-ai/sdk';

/**
 * ANTHROPIC_API_KEY を環境から解決する。
 * Route Handler からのみ使うこと（クライアントに漏らさない）。
 */
export const anthropic = new Anthropic();

export const MODEL = 'claude-opus-5';

/**
 * 安全性分類器に弾かれた場合の代替モデルへのフォールバックを既定で有効にする。
 * 弾かれると HTTP 200 + stop_reason: 'refusal' で返るため、content を読む前に必ず分岐する。
 */
export const FALLBACK_BETAS = ['server-side-fallback-2026-07-01'] as const;
