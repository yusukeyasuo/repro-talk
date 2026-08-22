'use client';

/**
 * 例文の読み上げ。まずクラウドTTS（サーバ生成のMP3を <audio> で再生）を試し、
 * 使えないとき（OPENAI_API_KEY 未設定・生成失敗・再生ブロック）は
 * ブラウザ標準の speechSynthesis にフォールバックする。
 *
 * `<audio>` 再生は speechSynthesis のような「使ううちに固まる」現象が無いので、
 * クラウドが有効な限りブラウザ再起動は不要になる。
 */

// 無音WAV（iOS で <audio> を解錠するために gesture 内で一瞬再生する）
const SILENT_WAV =
  'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

// text → 音声URL（null=クラウド不可）。1セッション内は使い回す。
const urlCache = new Map<string, Promise<string | null>>();

let audioEl: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!audioEl) audioEl = new Audio();
  return audioEl;
}

// --- speechSynthesis フォールバック ---------------------------------------
let ssVoice: SpeechSynthesisVoice | null = null;
let initialized = false;

function initFallback() {
  if (initialized || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  initialized = true;
  const synth = window.speechSynthesis;
  const pick = () => {
    const vs = synth.getVoices();
    if (vs.length === 0) return;
    ssVoice = vs.find((v) => v.lang === 'en-US') ?? vs.find((v) => v.lang.startsWith('en')) ?? null;
  };
  pick();
  synth.addEventListener('voiceschanged', pick);
  // Chrome が勝手に一時停止して無音で固まるのを起こし続ける（フォールバック用）
  window.setInterval(() => {
    if (synth.speaking) {
      try {
        synth.resume();
      } catch {
        // 無視
      }
    }
  }, 8000);
}

function fallbackSpeak(text: string, onend: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onend();
    return;
  }
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (ssVoice) u.voice = ssVoice;
  let done = false;
  const fin = () => {
    if (done) return;
    done = true;
    onend();
  };
  u.onend = fin;
  u.onerror = fin;
  synth.speak(u);
  try {
    synth.resume();
  } catch {
    // 無視
  }
}

// --- クラウドTTS ----------------------------------------------------------
async function fetchTtsUrl(text: string): Promise<string | null> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null; // 503(未設定) / 生成失敗 → フォールバック
    const json = (await res.json()) as { url?: unknown };
    return typeof json.url === 'string' ? json.url : null;
  } catch {
    return null;
  }
}

function getUrl(text: string): Promise<string | null> {
  const key = text.trim();
  if (!urlCache.has(key)) urlCache.set(key, fetchTtsUrl(key));
  return urlCache.get(key)!;
}

/**
 * 文の音声URLを取りにいく（1セッション内はキャッシュ）。null=クラウド不可。
 * リプロダクションのワークスペースは playbackRate 制御と聴き比べのため自前の
 * `<audio>` を持つので、この関数で URL だけ借りて再生は自分で行う。
 */
export function getTtsUrl(text: string): Promise<string | null> {
  if (typeof window === 'undefined' || !text.trim()) return Promise.resolve(null);
  return getUrl(text);
}

/** 考える時間のあいだに先に音声URLを取りにいく（体感の遅延を消す）。 */
export function prefetch(text: string) {
  if (typeof window === 'undefined' || !text.trim()) return;
  void getUrl(text);
}

/** gesture 内で呼ぶ。<audio> と speechSynthesis の両方を解錠する（iOS 対策）。 */
export function unlock() {
  initFallback();
  const a = audio();
  if (a) {
    try {
      a.src = SILENT_WAV;
      void a.play().catch(() => {});
    } catch {
      // 無視
    }
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      // 無視
    }
  }
}

/** 読み上げる。終わったら onend を1回だけ呼ぶ。クラウド不可/失敗時は自動でフォールバック。 */
export function speak(text: string, opts?: { onend?: () => void }) {
  initFallback();
  const onend = opts?.onend ?? (() => {});
  let handled = false;
  const endOnce = () => {
    if (handled) return;
    handled = true;
    onend();
  };
  const toFallback = () => {
    if (handled) return;
    handled = true;
    fallbackSpeak(text, onend);
  };

  void getUrl(text)
    .then((url) => {
      if (handled) return;
      if (!url) {
        toFallback();
        return;
      }
      const a = audio();
      if (!a) {
        toFallback();
        return;
      }
      a.onended = endOnce;
      a.onerror = toFallback;
      try {
        a.src = url;
        a.currentTime = 0;
        void a.play().catch(toFallback); // 再生がブロックされたら speechSynthesis へ
      } catch {
        toFallback();
      }
    })
    .catch(toFallback);
}

/** 再生を止める（<audio> と speechSynthesis の両方）。 */
export function cancel() {
  const a = audio();
  if (a) {
    try {
      a.pause();
    } catch {
      // 無視
    }
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 無視
    }
  }
}
