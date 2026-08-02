'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** iOS Safari は audio/mp4 しか吐かない。決め打ちにしない。 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'bin';
}

/**
 * マイク許可のプロンプトに応答がないまま固まると、ボタンが押せないだけの画面になる。
 * 一定時間で諦めて理由を出す。
 */
const PERMISSION_TIMEOUT_MS = 15_000;

function requestMicrophone(): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new DOMException('microphone request timed out', 'TimeoutError'));
    }, PERMISSION_TIMEOUT_MS);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        clearTimeout(timer);
        // タイムアウト後に届いたら掴んだままにせず解放する
        if (settled) stream.getTracks().forEach((track) => track.stop());
        else resolve(stream);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!settled) reject(error);
      },
    );
  });
}

export type RecordedClip = {
  blob: Blob;
  url: string;
  mimeType: string;
  durationSec: number;
};

type RecorderState = 'idle' | 'requesting' | 'recording' | 'error';

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (state === 'recording' || state === 'requesting') return;
    setError(null);
    setState('requesting');

    try {
      const stream = await requestMicrophone();
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      setState('recording');
    } catch (e) {
      cleanup();
      setState('error');
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'マイクの使用が許可されませんでした。ブラウザの設定で許可してください。'
          : name === 'TimeoutError'
            ? 'マイクの許可を確認できませんでした。ブラウザのアドレスバーの許可ダイアログを確認してください。'
            : name === 'NotFoundError'
              ? 'マイクが見つかりませんでした。'
              : 'マイクを開始できませんでした。',
      );
    }
  }, [cleanup, state]);

  const stop = useCallback((): Promise<RecordedClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      cleanup();
      setState('idle');
      return Promise.resolve(null);
    }

    return new Promise<RecordedClip | null>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        chunksRef.current = [];
        cleanup();
        setState('idle');
        resolve(
          blob.size > 0
            ? { blob, url: URL.createObjectURL(blob), mimeType, durationSec }
            : null,
        );
      };
      recorder.stop();
    });
  }, [cleanup]);

  return { state, elapsedSec, error, start, stop, isRecording: state === 'recording' };
}
