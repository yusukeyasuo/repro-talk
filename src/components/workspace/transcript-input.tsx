'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cleanTranscript } from '@/lib/transcript';

type Props = {
  initialValue: string;
  onSave: (text: string) => void | Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
};

/**
 * YouTube の「文字起こしを表示」からコピーしたテキストを貼り付ける。
 * 自動取得はしない（公式 API 経路が塞がっており安定して取れないため）。
 */
export function TranscriptInput({ initialValue, onSave, onCancel, saving }: Props) {
  const [raw, setRaw] = useState(initialValue);
  const [removed, setRemoved] = useState<number | null>(null);

  function clean() {
    const result = cleanTranscript(raw);
    setRaw(result.text);
    setRemoved(result.removedTimestamps);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">スクリプトの取り方</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>YouTube でこの動画を開き、概要欄の下の「文字起こしを表示」を押す</li>
          <li>練習する区間の行を選択してコピー</li>
          <li>下に貼り付けて「タイムスタンプを除去」を押す</li>
        </ol>
      </div>

      <Textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={10}
        placeholder={'0:00 Good morning.\n0:03 Incredibly, the cherry blossom survived...'}
        className="font-mono text-sm"
      />

      {removed !== null && (
        <p className="text-xs text-muted-foreground">
          {removed} 個のタイムスタンプを除去しました。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={clean} disabled={!raw.trim()}>
          タイムスタンプを除去
        </Button>
        <Button size="sm" onClick={() => onSave(raw.trim())} disabled={!raw.trim() || saving}>
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
