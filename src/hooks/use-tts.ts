'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 瞬間英作文の答えを読み上げる。ブラウザ標準の音声合成（Web Speech Synthesis）を使う。
 * これは音声「合成」（TTS）で、避けた音声「認識」（STT）とは別物。無料・鍵不要で、
 * iOS Safari を含め広く使える（声質は OS 依存）。
 *
 * 罠への対応：
 * - 声は非同期にロードされる（`voiceschanged` を待って選び直す）
 * - iOS は最初の発話をユーザー操作の連鎖内で起こさないとブロックする → `unlock()` を
 *   スタート押下時に呼び、無音の発話で一度解錠する
 * - 非対応環境では `speak()` が即 `onend` を呼ぶ（呼び出し側が固定秒送りにできる）
 */
export function useTts(lang = 'en-US') {
  // SSR とのハイドレーション差分を避けるため、初期値は true にして effect で判定する
  const [supported, setSupported] = useState(true);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // 声の選択だけを effect でやる（setState はしない＝ ref に入れる）。
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const base = lang.split('-')[0];
    const pick = () => {
      const voices = synth.getVoices();
      if (voices.length === 0) return;
      voiceRef.current =
        voices.find((v) => v.lang === lang || v.lang.replace('_', '-') === lang) ??
        voices.find((v) => v.lang.startsWith(base)) ??
        null;
    };
    pick();
    synth.addEventListener('voiceschanged', pick);
    return () => synth.removeEventListener('voiceschanged', pick);
  }, [lang]);

  // 非対応の確定は effect ではなくコールバックで行う（effect 内 setState を避ける）。
  // unlock() はプレイヤーがマウント時に呼ぶので、最初の読み上げ前に supported が確定する。
  const unlock = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSupported(false);
      return;
    }
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      // 解錠に失敗しても本編の speak() で改めて試す
    }
  }, []);

  const speak = useCallback(
    (text: string, opts?: { onend?: () => void; rate?: number }) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSupported(false);
        opts?.onend?.();
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel(); // 残っている発話を止める
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      if (voiceRef.current) u.voice = voiceRef.current;
      if (opts?.rate) u.rate = opts.rate;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        opts?.onend?.();
      };
      u.onend = finish;
      u.onerror = finish; // エラーでも次へ進める（詰まらせない）
      synth.speak(u);
    },
    [lang],
  );

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  return { supported, unlock, speak, cancel };
}
