import { NextResponse } from 'next/server';

import { badRequest, unauthorized } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized(); // 生成はログインユーザーだけ（OpenAI コストの濫用防止）

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
  const publicUrl = supabase.storage.from('tts').getPublicUrl(filename).data.publicUrl;

  // キャッシュ存在チェック（公開URLを HEAD）。あればそのまま返す。
  try {
    const head = await fetch(publicUrl, { method: 'HEAD' });
    if (head.ok) return NextResponse.json({ url: publicUrl, cached: true });
  } catch {
    // ネットワーク不通などは生成側へフォールスルー
  }

  // 生成（OpenAI Text-to-Speech）。Storage REST へは ArrayBuffer をそのまま body で送る。
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
      const detail = await res.text().catch(() => '');
      console.error('[api/tts] OpenAI generation failed', res.status, detail.slice(0, 300));
      return NextResponse.json({ error: `TTS generation failed (${res.status})` }, { status: 502 });
    }
    audio = await res.arrayBuffer();
  } catch (e) {
    console.error('[api/tts] OpenAI unreachable', e);
    return NextResponse.json({ error: 'TTS provider unreachable' }, { status: 502 });
  }

  // 公開バケットへ保存（同名は上書き）。以後この文はキャッシュから即返る。
  // 保存はサーバ専用の特権キー（service role / secret）で行う。SSR サーバクライアントの
  // storage はユーザー JWT を確実に載せられず（/api は proxy のセッション更新対象外で失効も絡む）
  // RLS に弾かれるため。認証は上の getUser で担保済み。未設定ならフォールバックさせる。
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error('[api/tts] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'TTS storage is not configured' }, { status: 503 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/tts/${filename}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'content-type': 'audio/mpeg',
      'x-upsert': 'true',
    },
    body: audio,
  });
  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => '');
    console.error('[api/tts] upload failed', uploadRes.status, detail.slice(0, 300));
    return NextResponse.json({ error: `保存に失敗しました (${uploadRes.status})` }, { status: 500 });
  }

  return NextResponse.json({ url: publicUrl, cached: false });
}
