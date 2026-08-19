import { createHash } from 'node:crypto';

/**
 * クラウドTTSのキャッシュキー生成（サーバ専用）。
 * 同じ文・声・モデルなら同じファイル名になり、2回目以降は生成せずキャッシュを返す。
 * 文字列は前後空白の除去＋連続空白の単一化だけ正規化する（意味を変えない範囲）。
 */

export const TTS_MODEL = 'tts-1';
export const TTS_VOICE = 'alloy';

export function normalizeTtsText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function ttsCacheKey(
  text: string,
  opts?: { model?: string; voice?: string },
): string {
  const model = opts?.model ?? TTS_MODEL;
  const voice = opts?.voice ?? TTS_VOICE;
  const hash = createHash('sha256')
    .update(`${model}|${voice}|${normalizeTtsText(text)}`)
    .digest('hex');
  return `${hash}.mp3`;
}
