/**
 * 学習時間の計測まわりの純粋ロジック。
 *
 * 経過時間は「開始時刻を DB に持ち、今との差で毎回計算する」。
 * カウンタを進めないので、ページ遷移・リロード・アプリの切り替えを跨いでも狂わない。
 * 日付の扱いは `daily_activity` ビューと `src/lib/activity.ts` に合わせて Asia/Tokyo 固定。
 */

import type { StudyKind } from '@/types/database';

/**
 * これを超えて計測中のままなら「終了ボタンの押し忘れ」とみなす。
 * 6時間 = 1回の学習としては現実的でない長さ、かつ一晩は跨がない値。
 */
export const STUDY_STALE_SEC = 6 * 60 * 60;

/** あとから直すときに受け付ける上限（12時間）。誤入力で連続日数を壊さないための箍。 */
export const STUDY_MAX_SEC = 12 * 60 * 60;

export const STUDY_KIND_LABELS: Record<StudyKind, string> = {
  reproduction: 'リプロダクション',
  monologue: '独り言',
  composition: '瞬間英作文',
};

/** 開始時刻からの経過秒。now を渡せるのでテストできる。 */
export function elapsedSec(startedAt: string, now: number = Date.now()): number {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

/** 計測中の時計。h:mm:ss（1時間未満は mm:ss）。数字とコロンだけなので font-mono に入れてよい。 */
export function formatClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 学習時間の表示。「1時間35分」形式。
 * 日本語を含むので font-mono の中に入れない（Geist Mono に日本語グリフが無い）。
 */
export function formatDurationHm(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  if (safe < 60) return safe === 0 ? '0分' : '1分未満';
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

const JST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' });
const JST_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO 文字列 → JST の 'YYYY-MM-DD' */
export function jstDateOf(iso: string): string {
  return JST_DATE.format(new Date(iso));
}

/** ISO 文字列 → JST の 'HH:mm'（<input type="time"> にそのまま入る） */
export function jstTimeOf(iso: string): string {
  return JST_TIME.format(new Date(iso));
}

/**
 * JST の日付＋時刻から ISO 文字列を作る。
 * 端末のタイムゾーンに依らないよう、必ず +09:00 を明示して解釈する。
 * 不正な入力は null（呼び出し側で弾く）。
 */
export function jstIsoFrom(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** 開始時刻と学習時間（秒）から終了時刻を作る。あとから直すときはこれで ended_at を動かす。 */
export function endedAtFrom(startedAtIso: string, durationSec: number): string | null {
  const started = new Date(startedAtIso).getTime();
  if (Number.isNaN(started)) return null;
  const clamped = Math.min(STUDY_MAX_SEC, Math.max(0, Math.round(durationSec)));
  return new Date(started + clamped * 1000).toISOString();
}
