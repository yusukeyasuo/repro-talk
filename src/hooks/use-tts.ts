'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * 音声合成エンジンを起こす（＝解錠）。ユーザー操作の中で一度呼ぶと iOS でも発話できる。
 * 無音の1発話を投げるだけ。対応していれば true。
 */
export function primeSpeech(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    // 無音の1発話で解錠する。cancel()/resume() は Chrome を固まらせる誘因になり得るので呼ばない。
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/**
 * 瞬間英作文の答えを読み上げる。ブラウザ標準の音声合成（Web Speech Synthesis, = TTS）を使う。
 * 声は非同期ロード（`voiceschanged` を待つ）／iOS はユーザー操作起点でないと発話がブロックされる
 * （`unlock()` で解錠）／非対応環境では `speak()` が即 `onend` を呼ぶ（固定秒送りにできる）。
 * cancel() の多用は Chrome の音声エンジンを固まらせる誘因になるため最小限にする。
 */
export function useTts(lang = 'en-US') {
  // SSR とのハイドレーション差分を避けるため、初期値は true にして effect で判定する
  const [supported, setSupported] = useState(true);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // 連続で onstart が来なかった回数（＝固着の疑い）。onstart で 0 に戻す。
  const stuckStreakRef = useRef(0);
  // 「再読み込みして」の案内は1セッション1回だけ出す
  const notifiedRef = useRef(false);

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

  // keepalive: Chrome は数秒〜十数秒で勝手に一時停止し、そのまま無音で固まることがある。
  // 発話中は定期的に resume() で起こし続ける（resume は再生中なら実害なし）。
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const id = window.setInterval(() => {
      const synth = window.speechSynthesis;
      if (synth.speaking) {
        try {
          synth.resume();
        } catch {
          // 非対応でも無視
        }
      }
    }, 8000);
    return () => window.clearInterval(id);
  }, []);

  // 非対応の確定は effect ではなくコールバックで行う（effect 内 setState を避ける）。
  // unlock() はプレイヤーがマウント時に呼ぶので、最初の読み上げ前に supported が確定する。
  const unlock = useCallback(() => {
    if (!primeSpeech()) setSupported(false);
  }, []);

  const speak = useCallback(
    (text: string, opts?: { onend?: () => void; rate?: number }) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSupported(false);
        opts?.onend?.();
        return;
      }
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      if (voiceRef.current) u.voice = voiceRef.current;
      if (opts?.rate) u.rate = opts.rate;

      let started = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        opts?.onend?.();
      };
      u.onstart = () => {
        started = true;
        stuckStreakRef.current = 0; // 正常に鳴った → 固着カウントをリセット
      };
      u.onend = finish;
      u.onerror = finish; // エラーでも次へ進める（詰まらせない）

      // 前の発話は goNext / アンマウント側で（必要なときだけ）止めている。ここでは cancel しない
      // （Chrome は cancel() 直後の speak() を握り潰すことがあるため）。
      synth.speak(u);
      // Chrome は一時停止状態のまま無音になることがあるので resume で起こす
      try {
        synth.resume();
      } catch {
        // 非対応でも speak 済み
      }

      // 固着ウォッチドッグ: 声があるのに onstart が来なければ、resume で蘇生を試みる。
      // それでも始まらなければ「固着」を数え、続くようなら再読み込みを一度だけ促す。
      const hasVoices = !!voiceRef.current || synth.getVoices().length > 0;
      if (hasVoices) {
        window.setTimeout(() => {
          if (started || done) return;
          try {
            synth.resume();
          } catch {
            // 無視
          }
          window.setTimeout(() => {
            if (started || done) return;
            stuckStreakRef.current += 1;
            if (stuckStreakRef.current >= 3 && !notifiedRef.current) {
              notifiedRef.current = true;
              toast.error(
                '音声が反応しなくなっています。ページを再読み込み（Cmd+R / Ctrl+R）すると直ります。それでもダメならブラウザを再起動してください。',
              );
            }
          }, 500);
        }, 700);
      }
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
