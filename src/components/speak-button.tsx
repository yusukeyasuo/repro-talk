'use client';

import { Square, Volume2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import * as speaker from '@/lib/speaker';
import { cn } from '@/lib/utils';

type State = 'idle' | 'loading' | 'playing';

/**
 * 読み上げボタン。クリックの中で解錠してから読み上げる（iOS 対策）。
 * 初出の文はサーバで音声を作るぶん数秒かかるので、押した瞬間にスピナーへ変えて
 * 「押せている」ことを見せる。鳴っている間は停止アイコン。もう一度押すと止まる。
 */
export function SpeakButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<State>('idle');

  function onClick() {
    if (state !== 'idle') {
      speaker.cancel();
      setState('idle');
      return;
    }
    speaker.unlock();
    setState('loading');
    speaker.speak(text, {
      onstart: () => setState('playing'),
      onend: () => setState('idle'),
      onabort: () => setState('idle'),
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={state === 'idle' ? label : '読み上げを止める'}
      aria-busy={state === 'loading'}
      className={cn('shrink-0', state !== 'idle' && 'text-primary')}
    >
      {state === 'loading' ? (
        <Spinner className="size-4" aria-label="音声を準備中" />
      ) : state === 'playing' ? (
        <Square className="size-3.5 fill-current" />
      ) : (
        <Volume2 className="size-4" />
      )}
    </Button>
  );
}
