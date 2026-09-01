'use client';

import {
  Check,
  Ear,
  Mic,
  Pause,
  Play,
  Repeat,
  Square,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { logPractice, updateClip } from '@/app/actions/clips';
import { saveRecording } from '@/app/actions/recordings';
import { AnnotationEditor } from '@/components/annotation/annotation-editor';
import { useStudyGuard } from '@/components/study/study-guard';
import { YouTubePlayer, type PlayerHandle } from '@/components/player/youtube-player';
import { ExplainPanel } from '@/components/workspace/explain-panel';
import { PhrasePanel } from '@/components/workspace/phrase-panel';
import { SentencePlayer, type SentencePlayerHandle } from '@/components/workspace/sentence-player';
import { TranscriptInput } from '@/components/workspace/transcript-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { extensionForMimeType, useRecorder, type RecordedClip } from '@/hooks/use-recorder';
import { reanchorAnnotations } from '@/lib/annotation-anchor';
import { createClient } from '@/lib/supabase/client';
import { splitSentences } from '@/lib/transcript';
import { formatSeconds } from '@/lib/youtube';
import { normalizeAnnotations, type Annotation } from '@/types/annotation';
import type { Clip, Material, StudySession } from '@/types/database';

const RATES = [0.5, 0.75, 1] as const;

type Suggestion = { naturalized: string; note_ja: string };

type Props = {
  clip: Clip;
  /** source='text' のときは動画を持たないので undefined */
  material?: Material;
  userId: string;
  /** 計測中の学習。練習を始めるときに「計測せずに始めるか」を訊くのに使う */
  running: StudySession | null;
};

export function Workspace({ clip, material, userId, running }: Props) {
  const isText = clip.source === 'text';
  const { guard, dialog: studyGuardDialog } = useStudyGuard('reproduction', running);

  const playerRef = useRef<PlayerHandle>(null);
  const sentencePlayerRef = useRef<SentencePlayerHandle>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const abRef = useRef(false);

  const [transcript, setTranscript] = useState(clip.transcript);
  const [editingTranscript, setEditingTranscript] = useState(!clip.transcript);
  const [translation, setTranslation] = useState(clip.translation_ja ?? '');
  const [annotations, setAnnotations] = useState<Annotation[]>(clip.annotations ?? []);
  const [memo, setMemo] = useState(clip.memo ?? '');

  // 自作テキストは文単位で回す。オフセット付きのまま持ち、記号をその文だけに絞るのに使う。
  const sentences = useMemo(
    () => (isText ? splitSentences(transcript) : []),
    [isText, transcript],
  );
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [draft, setDraft] = useState(''); // text の本文編集ドラフト
  const [naturalizing, setNaturalizing] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const [rate, setRate] = useState<number>(1);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reps, setReps] = useState(0); // このセッションで数えた回数（表示・単調増加）
  const [pendingRep, setPendingRep] = useState(false); // 終端に達し「言えた」の確認待ちか
  const savedRepsRef = useRef(0); // うち practice_logs に保存済みの数
  const [repSaveState, setRepSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [abRunning, setAbRunning] = useState(false);

  const [recorded, setRecorded] = useState<RecordedClip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pending, startTransition] = useTransition();

  const recorder = useRecorder();

  useEffect(() => {
    if (isText) sentencePlayerRef.current?.setRate(rate);
    else playerRef.current?.setRate(rate);
  }, [rate, isText]);

  // 本文が変わって文数が減っても範囲外にならないよう、読むときに丸める
  const currentIndex = sentences.length > 0 ? Math.min(sentenceIndex, sentences.length - 1) : 0;

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
      if (isText) {
        sentencePlayerRef.current?.play({ loop: once ? false : loop });
        return;
      }
      playerRef.current?.playRange(clip.start_sec ?? 0, clip.end_sec ?? 0, once ? false : loop);
    },
    [isText, clip.start_sec, clip.end_sec, loop],
  );

  const pauseModel = useCallback(() => {
    if (isText) sentencePlayerRef.current?.pause();
    else playerRef.current?.pause();
  }, [isText]);

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
    if (abRef.current) {
      // 聴き比べ中はお手本 → 自分に渡すだけ。回数には数えない。
      playSelf();
      return;
    }
    // ループ再生は「聴くだけ」。1回再生して止めたときだけ、自分で言ってから
    // 「言えた」で数える（リスニング回数ではなく再現した回数を測る）。
    if (!loop) setPendingRep(true);
  }

  /** 「言えた」を押したときだけ回数を数える。text は次の文へ進む。 */
  function confirmRep() {
    setPendingRep(false);
    setReps((count) => count + 1);
    setRepSaveState('saving');
    if (isText) {
      setSentenceIndex(currentIndex + 1 < sentences.length ? currentIndex + 1 : currentIndex);
    }
  }

  /** 数えずにもう一度お手本を再生する（終端でまた「言えた」待ちになる）。 */
  function replayModel() {
    setPendingRep(false);
    playModel();
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
    pauseModel();
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
    setPendingRep(false);
    pauseModel();
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

  // 自作テキストを「完成された英語」に整える（任意）。採用すると transcript を差し替え、
  // 記号は surface で新テキストへ貼り直し、元文は source_text に残す。
  async function naturalize() {
    if (!transcript) return;
    setNaturalizing(true);
    setSuggestion(null);
    try {
      const res = await fetch('/api/ai/naturalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: transcript }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? '推敲に失敗しました');
        return;
      }
      setSuggestion({ naturalized: json.naturalized ?? '', note_ja: json.note_ja ?? '' });
    } catch {
      toast.error('通信に失敗しました');
    } finally {
      setNaturalizing(false);
    }
  }

  function adoptSuggestion() {
    if (!suggestion) return;
    const next = suggestion.naturalized;
    const original = transcript;
    const { annotations: reanchored, dropped } = reanchorAnnotations(annotations, transcript, next);
    startTransition(async () => {
      const result = await updateClip({
        id: clip.id,
        transcript: next,
        annotations: reanchored,
        translationJa: null,
        sourceText: original,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTranscript(next);
      setAnnotations(reanchored);
      setTranslation('');
      setSuggestion(null);
      setSentenceIndex(0);
      toast.success(
        dropped > 0
          ? `推敲後を採用しました（${dropped}個の記号は文が変わったため外しました）`
          : '推敲後を採用しました',
      );
    });
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
    // スクリプトが変わっても、記号は surface で新テキストへ貼り直す。
    // 文が消えた記号だけ落とす（全消しにはしない）。和訳は全体依存なので破棄する。
    const { annotations: reanchored, dropped } = reanchorAnnotations(annotations, transcript, next);
    startTransition(async () => {
      const result = await updateClip({
        id: clip.id,
        transcript: next,
        annotations: reanchored,
        translationJa: null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTranscript(next);
      setAnnotations(reanchored);
      setTranslation('');
      setEditingTranscript(false);
      if (isText) setSentenceIndex(0);
      toast.success(
        dropped > 0
          ? `スクリプトを保存しました（${dropped}個の記号は文が変わったため外しました）`
          : 'スクリプトを保存しました',
      );
    });
  }

  // リプロダクション回数の自動記録。押し忘れで回数が消えないよう、まだ保存していない分を
  // practice_logs へ差分で書き込む（本数ぶんの行を作る。daily_activity ビューが日付ごとに合算する）。
  const flushReps = useCallback(async () => {
    const delta = reps - savedRepsRef.current;
    if (delta <= 0) return;
    setRepSaveState('saving');
    savedRepsRef.current = reps; // 楽観的に進める
    const result = await logPractice({ clipId: clip.id, repCount: delta });
    if (!result.ok) {
      savedRepsRef.current -= delta; // 失敗したら戻す
      setRepSaveState('error');
      toast.error(`記録に失敗しました: ${result.error}`);
      return;
    }
    setRepSaveState('saved');
  }, [reps, clip.id]);

  // 再生が少し落ち着いたら自動記録する（debounce）
  useEffect(() => {
    if (reps <= savedRepsRef.current) return;
    const timer = setTimeout(() => {
      void flushReps();
    }, 2000);
    return () => clearTimeout(timer);
  }, [reps, flushReps]);

  // タブを離れる/リロード直前に未記録があればフラッシュ
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void flushReps();
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [flushReps]);

  // クリップ間の移動などアンマウント時にも未記録をフラッシュする
  const flushRepsRef = useRef(flushReps);
  useEffect(() => {
    flushRepsRef.current = flushReps;
  }, [flushReps]);
  useEffect(() => {
    return () => {
      void flushRepsRef.current();
    };
  }, []);

  // 1カラムのときも列を minmax(0,1fr) で止める。既定の auto 列は中身の min-content まで
  // 広がるので、収まらない行が1つあるだけでページ全体が画面より横に広がる。
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {studyGuardDialog}

      {/* 左: プレイヤーと録音 */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        {isText ? (
          <SentencePlayer
            ref={sentencePlayerRef}
            sentences={sentences}
            transcript={transcript}
            annotations={annotations}
            index={currentIndex}
            rate={rate}
            onIndexChange={(i) => {
              pauseModel();
              setPendingRep(false);
              setSentenceIndex(i);
            }}
            onSentenceEnd={handleRangeEnd}
            onPlayingChange={setPlaying}
          />
        ) : (
          <YouTubePlayer
            ref={playerRef}
            videoId={material?.youtube_video_id ?? ''}
            onRangeEnd={handleRangeEnd}
            onPlayingChange={setPlaying}
          />
        )}

        <div className="space-y-3 rounded-lg border p-4">
          {isText ? (
            <p className="text-xs text-muted-foreground">
              文を1つ再生して止め、同じように言えたら「言えた」を押します。次の文へ進みます。
            </p>
          ) : (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                {formatSeconds(clip.start_sec ?? 0)} – {formatSeconds(clip.end_sec ?? 0)}
              </span>
              <span>{Math.round((clip.end_sec ?? 0) - (clip.start_sec ?? 0))}秒</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={
                playing
                  ? () => pauseModel()
                  : () =>
                      guard(() => {
                        setPendingRep(false);
                        playModel();
                      })
              }
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing
                ? '止める'
                : loop
                  ? 'ループ再生'
                  : isText
                    ? '1文再生して止める'
                    : '1回再生して止める'}
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
            {uploading && <Spinner className="size-4 text-muted-foreground" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={recorder.isRecording ? 'destructive' : 'outline'}
              onClick={
                recorder.isRecording
                  ? () => void toggleRecording()
                  : () => guard(() => void toggleRecording())
              }
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

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-muted-foreground">今回のリプロダクション</p>
              <p className="text-2xl">
                <span className="font-mono tabular-nums">{reps}</span> 回
              </p>
            </div>
            <div className="ml-auto">
              {repSaveState === 'error' ? (
                <Button size="sm" variant="outline" onClick={() => void flushReps()}>
                  記録に失敗 · 再試行
                </Button>
              ) : repSaveState === 'saving' ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  記録中…
                </span>
              ) : repSaveState === 'saved' ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" />
                  記録済み
                </span>
              ) : null}
            </div>
          </div>

          {pendingRep ? (
            <div className="flex items-center gap-2">
              <Button size="sm" className="flex-1" onClick={confirmRep}>
                <Check className="size-4" />
                言えた
              </Button>
              <Button size="sm" variant="outline" onClick={replayModel}>
                <Repeat className="size-4" />
                もう一回
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              1文を再生して止めたら、自分で同じように言ってみて「言えた」を押します。聴くだけ・ループは数えません。
            </p>
          )}
        </div>
      </div>

      {/* 右: スクリプトと解析 */}
      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">スクリプト</h2>
            <div className="flex flex-wrap gap-2">
              {!editingTranscript && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (isText) setDraft(transcript);
                    setEditingTranscript(true);
                  }}
                >
                  {isText ? '本文を編集' : '貼り直す'}
                </Button>
              )}
              {isText && transcript && !editingTranscript && (
                <Button size="sm" variant="outline" onClick={naturalize} disabled={naturalizing}>
                  {naturalizing ? <Spinner className="size-3.5" /> : <Sparkles className="size-4" />}
                  {naturalizing ? '推敲中…' : 'AIで自然にする'}
                </Button>
              )}
              {transcript && !editingTranscript && (
                <Button size="sm" variant="outline" onClick={analyze} disabled={analyzing}>
                  {analyzing ? <Spinner className="size-3.5" /> : <Sparkles className="size-4" />}
                  {analyzing ? '解析中…' : 'AI で音を解析'}
                </Button>
              )}
              {saveState === 'error' ? (
                <Button size="sm" variant="outline" onClick={() => void persist()}>
                  保存に失敗 · 再試行
                </Button>
              ) : dirty ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
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

          {(analyzing || naturalizing) && (
            <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <Spinner className="size-4" />
              {analyzing ? 'AI が音の記号を付けています。' : 'AI が英文を推敲しています。'}
              10〜30秒ほどかかります。
            </p>
          )}

          {editingTranscript ? (
            isText ? (
              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={6}
                  placeholder="ここに英語のテキストを入れます。"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveTranscript(draft)}
                    disabled={pending || !draft.trim()}
                  >
                    {pending && <Spinner />}
                    {pending ? '保存中…' : '保存'}
                  </Button>
                  {transcript && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingTranscript(false)}
                      disabled={pending}
                    >
                      キャンセル
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <TranscriptInput
                initialValue={transcript}
                onSave={saveTranscript}
                onCancel={transcript ? () => setEditingTranscript(false) : undefined}
                saving={pending}
                startSec={clip.start_sec ?? 0}
                endSec={clip.end_sec ?? 0}
                youtubeVideoId={material?.youtube_video_id ?? ''}
              />
            )
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

          {suggestion && !editingTranscript && (
            <div className="space-y-2 rounded-lg border bg-accent/30 p-3">
              <p className="text-xs text-muted-foreground">推敲後</p>
              <p className="text-sm leading-relaxed">{suggestion.naturalized}</p>
              {suggestion.note_ja && (
                <p className="text-xs text-muted-foreground">{suggestion.note_ja}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={adoptSuggestion} disabled={pending}>
                  この英文を採用
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                  使わない
                </Button>
              </div>
            </div>
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
