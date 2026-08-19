import { NextResponse } from 'next/server';

import { badRequest, unauthorized } from '@/lib/api';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { TTS_MODEL, TTS_VOICE, normalizeTtsText, ttsCacheKey } from '@/lib/tts-cache';

// 生成は最大でも数秒。長文でも十分な余裕を取る。
export const maxDuration = 60;

const MAX_LEN = 500;

/**
 * 例文の英語を読み上げる音声(MP3)の URL を返す。
 * 同じ文はキャッシュ（公開バケット `tts`）を返し、無ければ OpenAI TTS で生成して保存する。
 * OPENAI_API_KEY 未設定なら 503 を返し、クライアントは speechSynthesis にフォールバックする。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'TTS is not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('リクエストの形式が不正です');
  }
  const raw = (body as { text?: unknown })?.text;
  if (typeof raw !== 'string' || !raw.trim()) return badRequest('text が空です');
  const text = normalizeTtsText(raw).slice(0, MAX_LEN);

  const filename = ttsCacheKey(text);
  const supabase = await createClient();
  const publicUrl = supabase.storage.from('tts').getPublicUrl(filename).data.publicUrl;

  // キャッシュ存在チェック（公開URLを HEAD）。あればそのまま返す。
  try {
    const head = await fetch(publicUrl, { method: 'HEAD' });
    if (head.ok) return NextResponse.json({ url: publicUrl, cached: true });
  } catch {
    // ネットワーク不通などは生成側へフォールスルー
  }

  // 生成（OpenAI Text-to-Speech）
  let audio: ArrayBuffer;
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `TTS generation failed (${res.status})` }, { status: 502 });
    }
    audio = await res.arrayBuffer();
  } catch {
    return NextResponse.json({ error: 'TTS provider unreachable' }, { status: 502 });
  }

  // 公開バケットへ保存（同名は上書き）。以後この文はキャッシュから即返る。
  const { error: upErr } = await supabase.storage
    .from('tts')
    .upload(filename, audio, { contentType: 'audio/mpeg', upsert: true });
  if (upErr) {
    return NextResponse.json({ error: `保存に失敗しました: ${upErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ url: publicUrl, cached: false });
}
