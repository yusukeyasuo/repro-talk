/**
 * YouTube の動画ページで字幕を読み取り、`m:ss テキスト` 形式でクリップボードへ入れる
 * ブックマークレット。ユーザーのブラウザ・セッション・IP で動くため、サーバー自動取得と違い
 * YouTube のブロックを受けない（＝手動コピペの自動化に留まる。音源DLはしない）。
 *
 * `reproGrabTranscript` を `.toString()` して `javascript:` URL 化する。そのため関数は
 * **完全に自己完結**（外部スコープ参照なし）で書く。`.toString()` の結果が単体で動くよう、
 * トランスパイラのランタイムヘルパを呼び込む async/await・スプレッドは避ける
 * （let/const/optional-catch はモダンブラウザで素のまま動くので使ってよい）。
 * `//` 行コメントも使わない（1行に潰されても壊れないように）。
 */

type CaptionTrack = { baseUrl: string; languageCode?: string; kind?: string };
type Json3 = { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> };

// 取得ロジック本体。youtube.com 上で実行される前提。
function reproGrabTranscript() {
  const fmtTime = (sec: number) => {
    const pad = (n: number) => (n < 10 ? '0' : '') + n;
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  };

  const showResult = (text: string, note: string) => {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;z-index:2147483647;top:16px;right:16px;width:360px;max-width:90vw;background:#fff;color:#111;border:1px solid #ccc;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;font:13px/1.5 system-ui,sans-serif';
    const title = document.createElement('div');
    title.textContent = note;
    title.style.cssText = 'font-weight:600;margin-bottom:8px';
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText =
      'width:100%;height:140px;box-sizing:border-box;font:12px/1.4 ui-monospace,monospace;border:1px solid #ddd;border-radius:8px;padding:8px;resize:vertical';
    const close = document.createElement('button');
    close.textContent = '閉じる';
    close.style.cssText =
      'margin-top:8px;padding:6px 12px;border:1px solid #ccc;border-radius:8px;background:#f5f5f5;cursor:pointer';
    close.onclick = () => {
      if (box.parentNode) box.parentNode.removeChild(box);
    };
    box.appendChild(title);
    box.appendChild(ta);
    box.appendChild(close);
    document.body.appendChild(box);
    ta.focus();
    ta.select();
    try {
      navigator.clipboard.writeText(text).then(
        () => {
          title.textContent = 'コピーしました。repro-talk に戻って貼り付け → 「この区間だけ切り出す」';
        },
        () => {
          title.textContent = 'Cmd/Ctrl+C でコピーしてください（自動コピー不可）';
        },
      );
    } catch {
      title.textContent = 'Cmd/Ctrl+C でコピーしてください';
    }
  };

  const buildFromJson3 = (data: Json3) => {
    const events = (data && data.events) || [];
    const lines: string[] = [];
    let lastText = '';
    for (let j = 0; j < events.length; j++) {
      const ev = events[j];
      if (!ev || !ev.segs) continue;
      let txt = '';
      for (let k = 0; k < ev.segs.length; k++) {
        txt += ev.segs[k].utf8 || '';
      }
      txt = txt.replace(/\s+/g, ' ').trim();
      if (!txt || txt === lastText) continue;
      lastText = txt;
      lines.push(fmtTime((ev.tStartMs || 0) / 1000) + ' ' + txt);
    }
    return lines;
  };

  const fromPanel = () => {
    const segs = document.querySelectorAll('ytd-transcript-segment-renderer');
    const out: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const ts = segs[i].querySelector('.segment-timestamp');
      const tx = segs[i].querySelector('.segment-text');
      const line = (((ts && ts.textContent) || '') + ' ' + ((tx && tx.textContent) || ''))
        .replace(/\s+/g, ' ')
        .trim();
      if (line) out.push(line);
    }
    return out;
  };

  const fallback = () => {
    const out = fromPanel();
    if (out.length) {
      showResult(out.join('\n'), '字幕を取得しました（' + out.length + '行・パネルから）');
      return;
    }
    alert('字幕が見つかりませんでした。動画に字幕があるか、「文字起こしを表示」を開いてからもう一度試してください。');
  };

  let tracks: CaptionTrack[] = [];
  try {
    const pr = (
      window as unknown as {
        ytInitialPlayerResponse?: {
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
        };
      }
    ).ytInitialPlayerResponse;
    if (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer) {
      tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks || [];
    }
  } catch {
    tracks = [];
  }

  if (!tracks.length) {
    fallback();
    return;
  }

  let pick = tracks[0];
  let best = -1;
  for (let i = 0; i < tracks.length; i++) {
    let score = 0;
    if ((tracks[i].languageCode || '').indexOf('en') === 0) score += 2;
    if (tracks[i].kind !== 'asr') score += 1;
    if (score > best) {
      best = score;
      pick = tracks[i];
    }
  }

  fetch(pick.baseUrl + '&fmt=json3')
    .then((r) => r.json())
    .then((data: Json3) => {
      const lines = buildFromJson3(data);
      if (lines.length) {
        showResult(lines.join('\n'), '字幕を取得しました（' + lines.length + '行）');
      } else {
        fallback();
      }
    })
    .catch(() => {
      fallback();
    });
}

/** ブックマークバーにドラッグして使う `javascript:` URL。 */
export const TRANSCRIPT_BOOKMARKLET_HREF = `javascript:(${reproGrabTranscript.toString()})();void 0`;
