'use client';

import { ExternalLink, Scissors } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { TRANSCRIPT_BOOKMARKLET_HREF } from '@/lib/transcript-bookmarklet';
import { cleanTranscript, trimTranscriptToRange } from '@/lib/transcript';

type Props = {
  initialValue: string;
  onSave: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
  /** この clip の区間。貼り付けた全文をこの範囲に絞るのに使う。 */
  startSec: number;
  endSec: number;
  youtubeVideoId: string;
};

// 行頭にタイムスタンプがあるか（「この区間だけ切り出す」を出すかの判定）
const HAS_TIMESTAMP = /^\s*[[(]?\d{1,2}:\d{2}/m;

/**
 * スクリプトを貼り付ける。取得は「字幕を取得」ブックマークレット（ユーザーのブラウザで動く）か、
 * 従来どおり「文字起こしを表示」からの手動コピペ。サーバー側の自動取得はしない。
 */
export function TranscriptInput({
  initialValue,
  onSave,
  onCancel,
  saving,
  startSec,
  endSec,
  youtubeVideoId,
}: Props) {
  const [raw, setRaw] = useState(initialValue);
  const [notice, setNotice] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  // React 19 は href の javascript: を無効化するので、ref で直接属性をセットする。
  useEffect(() => {
    bookmarkletRef.current?.setAttribute('href', TRANSCRIPT_BOOKMARKLET_HREF);
  }, []);

  const hasTimestamps = HAS_TIMESTAMP.test(raw);
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}&t=${Math.floor(startSec)}s`;

  function clean() {
    const result = cleanTranscript(raw);
    setRaw(result.text);
    setNotice(`${result.removedTimestamps} 個のタイムスタンプを除去しました。`);
  }

  function trimToRange() {
    const result = trimTranscriptToRange(raw, startSec, endSec);
    setRaw(result.text);
    if (!result.hadTimestamps) {
      setNotice('タイムスタンプが無いので整形だけしました。');
    } else if (result.keptCues === 0) {
      setNotice('この区間に該当する字幕がありませんでした。開始・終了位置を確認してください。');
    } else {
      setNotice(`この区間に重なる字幕 ${result.keptCues} 件に絞りました。`);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">スクリプトの取り方</p>
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          <li>
            初回だけ：
            <a
              ref={bookmarkletRef}
              href="#"
              draggable
              onClick={(e) => {
                e.preventDefault();
                setNotice('このボタンをブラウザのブックマークバーにドラッグして登録してください。');
              }}
              title="ブックマークバーにドラッグして登録します"
              className="mx-1 inline-flex cursor-grab items-center rounded-md border border-foreground/30 bg-background px-2 py-0.5 font-medium text-foreground active:cursor-grabbing"
            >
              字幕を取得
            </a>
            をブックマークバーにドラッグ
          </li>
          <li>
            <a
              href={watchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
            >
              この動画を YouTube で開く
              <ExternalLink className="size-3" />
            </a>
            → ページ上でブックマーク「字幕を取得」を押す
          </li>
          <li>ここに貼り付け →「この区間だけ切り出す」で30秒ぶんに絞る</li>
        </ol>

        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="mt-2 text-foreground/70 underline underline-offset-2"
        >
          うまくいかないとき
        </button>
        {showManual && (
          <div className="mt-1 space-y-1 border-l-2 pl-2">
            <p>
              <span className="font-medium text-foreground">手動コピペ：</span>
              YouTube の概要欄下「文字起こしを表示」を開き、練習する区間の行を選択してコピー →
              ここに貼り付け →「タイムスタンプを除去」。
            </p>
            <p>
              <span className="font-medium text-foreground">ブックマーク登録：</span>
              ドラッグできないときは、新しいブックマークを作り URL 欄に「字幕を取得」リンクの
              アドレスを貼り付けても登録できます。
            </p>
          </div>
        )}
      </div>

      <Textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={10}
        placeholder={'0:00 Good morning.\n0:03 Incredibly, the cherry blossom survived...'}
        className="font-mono text-sm"
      />

      {notice !== null && <p className="text-xs text-muted-foreground">{notice}</p>}

      <div className="flex flex-wrap gap-2">
        {hasTimestamps && (
          <Button variant="outline" size="sm" onClick={trimToRange}>
            <Scissors className="size-4" />
            この区間だけ切り出す
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={clean} disabled={!raw.trim()}>
          タイムスタンプを除去
        </Button>
        <Button size="sm" onClick={() => onSave(raw.trim())} disabled={!raw.trim() || saving}>
          {saving && <Spinner className="size-3.5" />}
          {saving ? '保存中…' : 'スクリプトを保存'}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
        )}
      </div>
    </div>
  );
}
