'use client';

import { Pause, Play, Scissors } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createClip } from '@/app/actions/clips';
import { YouTubePlayer, type PlayerHandle } from '@/components/player/youtube-player';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { formatSeconds } from '@/lib/youtube';

type Props = {
  materialId: string;
  videoId: string;
};

export function ClipCreator({ materialId, videoId }: Props) {
  const router = useRouter();
  const playerRef = useRef<PlayerHandle>(null);
  const [currentSec, setCurrentSec] = useState(0);
  const [startSec, setStartSec] = useState<number | null>(null);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [playing, setPlaying] = useState(false);
  const [pending, startTransition] = useTransition();

  const duration = startSec !== null && endSec !== null ? endSec - startSec : null;
  const canCreate = duration !== null && duration > 0;

  function preview() {
    if (startSec === null || endSec === null) return;
    playerRef.current?.playRange(startSec, endSec, true);
  }

  function submit() {
    if (startSec === null || endSec === null) return;
    startTransition(async () => {
      const result = await createClip({ materialId, startSec, endSec, label });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('クリップを作りました');
      router.push(`/clips/${result.data.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <YouTubePlayer
        ref={playerRef}
        videoId={videoId}
        onTime={setCurrentSec}
        onPlayingChange={setPlaying}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm tabular-nums">{formatSeconds(currentSec)}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            playing ? playerRef.current?.pause() : playerRef.current?.playRange(currentSec, 1e9)
          }
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? '一時停止' : '再生'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setStartSec(currentSec)}>
          ここから
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEndSec(currentSec)}>
          ここまで
        </Button>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            開始{' '}
            <span className="font-mono tabular-nums">
              {startSec === null ? '--:--' : formatSeconds(startSec)}
            </span>
          </span>
          <span>
            終了{' '}
            <span className="font-mono tabular-nums">
              {endSec === null ? '--:--' : formatSeconds(endSec)}
            </span>
          </span>
          {duration !== null && (
            <span className={duration > 0 ? '' : 'text-destructive'}>
              長さ <span className="font-mono tabular-nums">{Math.round(duration)}</span>秒
            </span>
          )}
        </div>

        {duration !== null && duration > 45 && (
          <p className="mt-2 text-xs text-muted-foreground">
            30秒くらいが目安です。長いと分析が続きません。
          </p>
        )}

        <div className="mt-4 space-y-2">
          <Label htmlFor="clip-label">メモ（任意）</Label>
          <Input
            id="clip-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="この部分がかっこいい、など"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={preview} disabled={!canCreate}>
            <Play className="size-4" />
            区間をループ再生
          </Button>
          <Button onClick={submit} disabled={!canCreate || pending}>
            {pending ? <Spinner /> : <Scissors className="size-4" />}
            {pending ? '作成中…' : 'クリップを作る'}
          </Button>
        </div>
      </div>
    </div>
  );
}
