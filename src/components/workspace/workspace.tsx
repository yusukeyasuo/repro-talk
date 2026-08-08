'use client';

import {
  Check,
  Ear,
  Loader2,
  Mic,
  Pause,
  Play,
  Repeat,
  Square,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { logPractice, updateClip } from '@/app/actions/clips';
import { saveRecording } from '@/app/actions/recordings';
import { AnnotationEditor } from '@/components/annotation/annotation-editor';
import { YouTubePlayer, type PlayerHandle } from '@/components/player/youtube-player';
import { ExplainPanel } from '@/components/workspace/explain-panel';
import { PhrasePanel } from '@/components/workspace/phrase-panel';
import { TranscriptInput } from '@/components/workspace/transcript-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { extensionForMimeType, useRecorder, type RecordedClip } from '@/hooks/use-recorder';
import { createClient } from '@/lib/supabase/client';
import { formatSeconds } from '@/lib/youtube';
import { normalizeAnnotations, type Annotation } from '@/types/annotation';
import type { Clip, Material } from '@/types/database';

const RATES = [0.5, 0.75, 1] as const;

type Props = {
  clip: Clip;
  material: Material;
  userId: string;
};

export function Workspace({ clip, material, userId }: Props) {
  const playerRef = useRef<PlayerHandle>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abRef = useRef(false);

  const [transcript, setTranscript] = useState(clip.transcript);
  const [editingTranscript, setEditingTranscript] = useState(!clip.transcript);
  const [translation, setTranslation] = useState(clip.translation_ja ?? '');
  const [annotations, setAnnotations] = useState<Annotation[]>(clip.annotations ?? []);
  const [memo, setMemo] = useState(clip.memo ?? '');

  const [rate, setRate] = useState<number>(1);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [abRunning, setAbRunning] = useState(false);

  const [recorded, setRecorded] = useState<RecordedClip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pending, startTransition] = useTransition();

  const recorder = useRecorder();

  useEffect(() => {
    playerRef.current?.setRate(rate);
  }, [rate]);

  // Blob URL を後片付けする
  useEffect(() => {
    return () => {
      if (recorded) URL.revokeObjectURL(recorded.url);
    };
  }, [recorded]);

  // once=true のときはループトグルを無視して必ず1回だけ再生する。
  // 聴き比べ（お手本 → 自分 → お手本 …）ではお手本が区間の終端で止まらないと
  // 録音に切り替わらないため、聴き比べ中は常に once で呼ぶ。
  const playModel = useCallback(
    ({ once = false }: { once?: boolean } = {}) => {
      playerRef.current?.playRange(clip.start_sec, clip.end_sec, once ? false : loop);
    },
    [clip.start_sec, clip.end_sec, loop],
  );

  const playSelf = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !recorded) {
      if (abRef.current) playModel({ once: true });
      return;
    }
    audio.currentTime = 0;
    void audio.play();
  }, [playModel, recorded]);

  /** お手本の区間が終わったとき。「1文再生 → 止める」がリプロダクションの要。 */
  function handleRangeEnd() {
    setRepCount((count) => count + 1);
    if (abRef.current) playSelf();
  }

  function startAb() {
    if (!recorded) return;
    abRef.current = true;
    setAbRunning(true);
    // お手本 → 自分 → お手本 … を繰り返す。お手本は毎回1回だけ再生する。
    playModel({ once: true });
  }

  function stopAb() {
    abRef.current = false;
    setAbRunning(false);
    playerRef.current?.pause();
    audioRef.current?.pause();
  }

  async function toggleRecording() {
    if (recorder.isRecording) {
      const result = await recorder.stop();
      if (!result) return;
      // 直前の Blob URL は setRecorded による effect の後片付けで解放される
      setRecorded(result);
      void uploadRecording(result);
      return;
    }
    // 録音中はお手本と被らないよう止める
    stopAb();
    playerRef.current?.pause();
    await recorder.start();
  }

  async function uploadRecording(result: RecordedClip) {
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${userId}/reproduction/${crypto.randomUUID()}.${extensionForMimeType(
        result.mimeType,
      )}`;
      const { error } = await supabase.storage
        .from('recordings')
        .upload(path, result.blob, { contentType: result.mimeType });

      if (error) {
        toast.error(`録音の保存に失敗しました: ${error.message}`);
        return;
      }

      const saved = await saveRecording({
        kind: 'reproduction',
        storagePath: path,
        mimeType: result.mimeType,
        durationSec: result.durationSec,
        clipId: clip.id,
      });
      if (!saved.ok) toast.error(saved.error);
    } finally {
      setUploading(false);
    }
  }

  async function analyze() {
    if (!transcript) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/ai/annotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '解析に失敗しました');
        return;
      }
      setTranslation(json.translation_ja ?? '');
      setAnnotations(normalizeAnnotations(json.annotations, transcript.length));
      setDirty(true);
      toast.success('解析しました。おかしいところは手で直せます。');
    } catch {
      toast.error('通信に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  }

  // 自動保存：和訳・マーキング・メモ・AI解析結果が変わったら少し待って保存する。
  // 手動保存を待たずに済むので、リロードしても STEP3 の作り込みが失われない。
  const persist = useCallback(async () => {
    setSaveState('saving');
    const result = await updateClip({
      id: clip.id,
      transcript,
      translationJa: translation || null,
      annotations,
      memo: memo || null,
    });
    if (!result.ok) {
      setSaveState('error');
      toast.error(`保存に失敗しました: ${result.error}`);
      return;
    }
    setDirty(false);
    setSaveState('saved');
  }, [clip.id, transcript, translation, annotations, memo]);

  // dirty になったら debounce して自動保存（スクリプト編集中は別導線なので除く）
  useEffect(() => {
    if (!dirty || editingTranscript) return;
    const timer = setTimeout(() => {
      void persist();
    }, 800);
    return () => clearTimeout(timer);
  }, [dirty, editingTranscript, persist]);

  // タブを離れる/リロード直前に、未保存があれば即フラッシュする（debounce の取りこぼし対策）
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && dirty) {
        void persist();
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [dirty, persist]);

  function saveTranscript(next: string) {
    startTransition(async () => {
      // スクリプトが変わったら文字インデックスがずれるので記号は破棄する
      const result = await updateClip({
        id: clip.id,
        transcript: next,
        annotations: [],
        translationJa: null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTranscript(next);
      setAnnotations([]);
      setTranslation('');
      setEditingTranscript(false);
      toast.success('スクリプトを保存しました');
    });
  }

  function recordReps() {
    if (repCount === 0) return;
    startTransition(async () => {
      const result = await logPractice({ clipId: clip.id, repCount });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${repCount} 回を記録しました`);
      setRepCount(0);
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {/* 左: プレイヤーと録音 */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <YouTubePlayer
          ref={playerRef}
          videoId={material.youtube_video_id}
          onRangeEnd={handleRangeEnd}
          onPlayingChange={setPlaying}
        />

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {formatSeconds(clip.start_sec)} – {formatSeconds(clip.end_sec)}
            </span>
            <span>{Math.round(clip.end_sec - clip.start_sec)}秒</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={playing ? () => playerRef.current?.pause() : () => playModel()}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? '止める' : loop ? 'ループ再生' : '1回再生して止める'}
            </Button>
            <Button
              size="sm"
              variant={loop ? 'default' : 'outline'}
              onClick={() => setLoop((v) => !v)}
            >
              <Repeat className="size-4" />
              ループ
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">速度</span>
            {RATES.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={rate === value ? 'default' : 'outline'}
                onClick={() => setRate(value)}
              >
                {value}x
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            0.5倍速は音を顕微鏡で覗くようなもの。音の繋がりと変化がはっきり見えます。
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">自分の音を録る</h3>
            {uploading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={recorder.isRecording ? 'destructive' : 'outline'}
              onClick={toggleRecording}
              disabled={recorder.state === 'requesting'}
            >
              {recorder.isRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
              {recorder.isRecording ? `停止 (${recorder.elapsedSec}秒)` : '録音'}
            </Button>

            {recorded && (
              <Button
                size="sm"
                variant={abRunning ? 'destructive' : 'default'}
                onClick={abRunning ? stopAb : startAb}
              >
                <Ear className="size-4" />
                {abRunning ? '聴き比べを止める' : '交互に聴き比べ'}
              </Button>
            )}
          </div>

          {recorder.error && <p className="text-xs text-destructive">{recorder.error}</p>}

          {recorded && (
            <audio
              ref={audioRef}
              src={recorded.url}
              controls
              className="w-full"
              onEnded={() => {
                if (abRef.current) playModel({ once: true });
              }}
            />
          )}

          <p className="text-xs text-muted-foreground">
            シャドーイングと違い、お手本と自分の声が重ならないのでごまかしが効きません。
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-lg border p-4">
          <div>
            <p className="text-xs text-muted-foreground">今回のリプロダクション</p>
            <p className="text-2xl">
              <span className="font-mono tabular-nums">{repCount}</span> 回
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={recordReps}
            disabled={repCount === 0 || pending}
          >
            記録する
          </Button>
        </div>
      </div>

      {/* 右: スクリプトと解析 */}
      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">スクリプト</h2>
            <div className="flex flex-wrap gap-2">
              {!editingTranscript && (
                <Button size="sm" variant="ghost" onClick={() => setEditingTranscript(true)}>
                  貼り直す
                </Button>
              )}
              {transcript && !editingTranscript && (
                <Button size="sm" variant="outline" onClick={analyze} disabled={analyzing}>
                  <Sparkles className="size-4" />
                  {analyzing ? '解析中…' : 'AI で音を解析'}
                </Button>
              )}
              {saveState === 'error' ? (
                <Button size="sm" variant="outline" onClick={() => void persist()}>
                  保存に失敗 · 再試行
                </Button>
              ) : dirty ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  保存中…
                </span>
              ) : saveState === 'saved' ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" />
                  保存済み
                </span>
              ) : null}
            </div>
          </div>

          {editingTranscript ? (
            <TranscriptInput
              initialValue={transcript}
              onSave={saveTranscript}
              onCancel={transcript ? () => setEditingTranscript(false) : undefined}
              saving={pending}
            />
          ) : (
            <AnnotationEditor
              text={transcript}
              annotations={annotations}
              onChange={(next) => {
                setAnnotations(next);
                setDirty(true);
              }}
            />
          )}
        </section>

        {transcript && !editingTranscript && (
          <>
            <section className="space-y-2">
              <h2 className="text-sm font-medium">日本語訳</h2>
              <Textarea
                value={translation}
                onChange={(e) => {
                  setTranslation(e.target.value);
                  setDirty(true);
                }}
                rows={3}
                placeholder="大体の意味が分かればOK。細かいことは後で。"
              />
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-medium">分からないところを聞く</h2>
              <ExplainPanel
                transcript={transcript}
                onAppendMemo={(markdown) => {
                  setMemo((prev) => (prev ? `${prev}\n\n${markdown}` : markdown));
                  setDirty(true);
                }}
              />
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">フレーズを独り言に渡す</h2>
                <Badge variant="secondary">0と100が繋がるところ</Badge>
              </div>
              <PhrasePanel clipId={clip.id} transcript={transcript} />
            </section>

            {memo && (
              <section className="space-y-2">
                <h2 className="text-sm font-medium">メモ</h2>
                <Textarea
                  value={memo}
                  onChange={(e) => {
                    setMemo(e.target.value);
                    setDirty(true);
                  }}
                  rows={8}
                  className="font-mono text-xs"
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
