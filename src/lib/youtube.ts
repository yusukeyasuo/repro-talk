/**
 * YouTube 関連ユーティリティ。
 *
 * 音源のダウンロード・切り出しは YouTube の利用規約に反するため一切行わない。
 * 再生は IFrame Player API 経由で、指定区間をループさせる。
 */

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** URL でも生の ID でも受け取って 11 文字の video ID を返す。 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;

    // /embed/<id>, /shorts/<id>, /live/<id>
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }

  return null;
}

export type YouTubeOEmbed = {
  title: string;
  author_name: string;
  thumbnail_url: string;
};

/**
 * oEmbed からタイトル・チャンネル名・サムネイルを取得する。
 * 公開エンドポイントなので API キーは不要。取得できなければ null。
 */
export async function fetchOEmbed(videoId: string): Promise<YouTubeOEmbed | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;

  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<YouTubeOEmbed>;
    if (!json.title) return null;
    return {
      title: json.title,
      author_name: json.author_name ?? '',
      thumbnail_url: json.thumbnail_url ?? thumbnailUrl(videoId),
    };
  } catch {
    return null;
  }
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function watchUrl(videoId: string, startSec?: number): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  return startSec ? `${base}&t=${Math.floor(startSec)}` : base;
}

/** 秒を m:ss 形式にする（区間の表示用）。 */
export function formatSeconds(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 秒を「1分30秒」形式にする（録音時間などの表示用）。 */
export function formatDurationJa(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m === 0) return `${s}秒`;
  if (s === 0) return `${m}分`;
  return `${m}分${s}秒`;
}
