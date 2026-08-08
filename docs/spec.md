# repro-talk 仕様

実装後の姿に合わせて書いてある。設計判断の背景は [`../CLAUDE.md`](../CLAUDE.md)、セットアップと使い方は [`../README.md`](../README.md) を参照。

---

## 1. 何のためのアプリか

YouTube動画「【結論！】英語が話せなかった私が1年未満でペラペラになったたった1つの方法」（Nanami / ななみ, [@nanamin_english](https://www.youtube.com/@nanamin_english)）で説明されている学習法を、1人で継続するための道具。

学習法の主張は「必要なのは2つだけ」というもの。

1. **リプロダクション** — 完成された英語を「100のまま」受け取る
2. **独り言** — 自力で「0から」英語を作り出す

そして、①で入れた表現を②で口から出せたときに両者が繋がる。アプリはこの3つをそのまま3本の導線にしている。

### 担保すること / しないこと

| | |
|---|---|
| **担保する** | 習慣化と可視化。紙とペンでやっていた音の書き込みの代替。ChatGPTへの手動コピペの内製化。①→②のフレーズの受け渡し |
| **担保しない** | 学習成果。元動画は個人の体験談で再現性の担保はなく、末尾は公式LINEへの誘導になっている |
| **意図的にやらない** | YouTube音源のダウンロード・切り出し（利用規約違反）。発音の自動採点（精度が出ず、誤った採点は学習者を害する）。音声認識（後述） |

---

## 2. 画面と機能

### 画面遷移

```
/login ──(Magic Link)──> /auth/callback ──> /
                                             │
   ┌─────────────┬──────────┴──────┬─────────────┐
   │             │                 │             │
/materials   /monologue        /phrases     /settings
   │
/materials/[id] ──(区間を切り出す)──> /clips/[id]
                                          │
                                    （フレーズ抽出）
                                          └──> /monologue の「今日使うフレーズ」へ
```

認証は `src/proxy.ts`（Next.js 16 の Proxy。旧 `middleware.ts`）で全ページを保護する。
`/api/` 以下は matcher の対象外なので、各 Route Handler が自分で認証する。

### `/` ダッシュボード

| 要素 | 内容 |
|---|---|
| Why バナー | `profiles.why_text`（英語の先に理解したい何か）を常時表示。未設定なら設定への誘導 |
| 今日やること | リプロダクション（作りかけのクリップ、無ければ新規切り出しへ）／独り言。当日完了なら「今日済み」バッジ |
| 続いている記録 | 連続日数、今週の独り言の合計時間、今週のリプロダクション回数 |
| ヒートマップ | 直近12週 × 7日。当日はリング表示、未来日は薄く |
| フレーズの残 | まだ使っていないフレーズ件数と、独り言への誘導 |

連続日数は「今日まだ何もしていなければ昨日から数える」。日付が変わるまでは途切れ扱いにしない。
日付境界は **Asia/Tokyo 固定**（`daily_activity` ビューと `src/lib/activity.ts` の両方）。

### `/materials` 素材ライブラリ

YouTube URL を貼って登録する。oEmbed でタイトル・チャンネル名・サムネイルを自動取得。
レベル別（L1〜L4）にグループ化して表示し、各素材のクリップ数を出す。

| レベル | 素材 | 位置づけ |
|---|---|---|
| L1 | 和訳付きフレーズ動画 | 日本語字幕つき・ゆっくり。まず音と意味を体に入れる |
| L2 | 英語学習者向け英語チャンネル | 英語字幕のみ。難易度と効果のバランスが良い |
| L3 | 興味分野の海外チャンネル | 好きなテーマを英語で検索。ロールモデルを見つける |
| L4 | 海外ドラマ・映画 | 作り物なので日常会話より速く語彙も難しい。最後の段階 |

URL は `watch?v=` / `youtu.be/` / `shorts/` / `embed/` / 生のID / プロトコルなし に対応する。

### `/materials/[id]` 区間の切り出し

動画を再生しながら「ここから」「ここまで」を打ってクリップを作る。
30秒が目安で、45秒を超えると注意を出す。作る前に区間をループ再生して確認できる。

### `/clips/[id]` リプロダクション・ワークスペース（中心画面）

紙とペンの代替。左（プレイヤーと録音）／右（スクリプトと解析）の2カラム。

**プレイヤー**

- 区間の A-B ループ。`end` パラメータはループしないので `requestAnimationFrame` で終端を監視して `seekTo` する
- **「1回再生して止める」** — 区間の終わりで自動停止する。リプロダクションの中核操作（シャドーイングとの違い）
- 再生速度 `0.5 / 0.75 / 1.0`。0.5倍速は「音を顕微鏡で覗く」用
- 「1回再生して止める」→ 自分で同じように言って **「言えた」** を押すとリプロダクション回数が増え、`practice_logs` に自動記録される。ループ再生・聴くだけは数えない（測るのはリスニング回数ではなく**再現した回数**）

**スクリプト**

YouTube の「文字起こしを表示」からコピーして貼り付ける。**自動取得はしない**（公式API経路が塞がれており安定して取れないため）。
貼り付け後「タイムスタンプを除去」で `0:00` / `[00:12]` / `(1:02:03)` / 単独行のタイムスタンプと `[音楽]` 等を落とし、字幕の途中改行を連結する。

**発音マーキング**

スクリプトの一部をドラッグして選択し、記号を付ける。動画でカラーペンでやっていた7種類。

| 種類 | 意味 | 表示 |
|---|---|---|
| `stress` | 強く発音する部分 | 赤・太字＋上に山 |
| `rise` | 音が上がるところ | 橙＋上向き矢印 |
| `drop` | 発音しない音（`good morning` の d） | 灰・取り消し線 |
| `link` | リンキング／連結 | 青の下線 |
| `flap_t` | フラップT（`yet another` が「イェラナザー」） | 緑の丸囲み |
| `reduction` | 短縮（`going to` → `gonna`） | 紫＋実際の音を上付き |
| `swallow` | 飲み込む音（`mountain`） | シアンの点線 |

「AI で音を解析」で下書きを作り、おかしいところは手で直す。AI の出力も手入力も
`normalizeAnnotations()` を通して範囲外・空範囲・未知の種別・重複IDを落とす。

**録音と聴き比べ**

録音して「交互に聴き比べ」を押すと、お手本 → 自分 → お手本 … を繰り返す。
シャドーイングと違って声が重ならないので誤魔化しが効かない、というのが元の主張。

**解説とフレーズ**

- 「分からないところを聞く」— 選択範囲と質問を投げると、文脈での意味・一般的な使われ方・独り言でそのまま使える例文3つが返る。メモに保存できる
- 「独り言で使えるフレーズを抽出」— 使い回せる「型」を3〜6個。ストックに追加すると `/monologue` に出てくる

### `/monologue` 独り言モード

スマホ片手・歩きながらを前提にした縦1カラム。

| 要素 | 内容 |
|---|---|
| 今日のお題 | 共通シード30件から日付ベースで1件。シャッフルで別のお題に |
| 1人電話 | 大きな録音ボタン、経過タイマー、目標に対する進捗バー。Wake Lock で画面を保つ |
| 今日使うフレーズ | 在庫（未卒業）を新しい順に3件。使えたらタップ＝その場で「身についた」へ卒業し、翌日から出なくなる |
| 言えなかったこと | 日本語でメモ → AI が自然な英語表現＋例文2つに変換 → そのままストックへ |

録音の**音声そのものは保存しない**（聴き返さないため）。残すのは話した**時間だけ**＝やった事実の可視化。まず1分から。

### `/phrases` フレーズ・ストック

リプロダクションで入れた表現。**在庫（未卒業）** と **身についた（卒業済み）** の2区分で表示。出典クリップへのリンク、削除。

### `/settings`

- **英語の先に理解したい何か**（`why_text`）— 継続の芯としてホームに常時出す
- **1日の独り言の目標**（1分 / 3分 / 5分 / 10分）
- ログアウト

---

## 3. データモデル

Supabase / PostgreSQL。**全テーブル RLS 有効、`user_id = auth.uid()` に限定**。

| テーブル | 列 | 役割 |
|---|---|---|
| `profiles` | `id`(=auth.users.id), `display_name`, `why_text`, `daily_goal_sec`, `created_at`, `updated_at` | サインアップ時にトリガで自動生成 |
| `materials` | `id`, `user_id`, `youtube_video_id`, `title`, `channel_name`, `level`, `thumbnail_url`, `created_at` | 素材。`(user_id, youtube_video_id)` で一意 |
| `clips` | `id`, `user_id`, `material_id`, `label`, `start_sec`, `end_sec`, `transcript`, `translation_ja`, `annotations`(jsonb), `memo`, `created_at`, `updated_at` | 練習区間。ノート1ページに相当 |
| `practice_logs` | `id`, `user_id`, `clip_id`, `rep_count`, `practiced_at` | リプロダクションの反復記録 |
| `monologue_topics` | `id`, `user_id`, `title_en`, `title_ja`, `category`, `sort_order`, `created_at` | `user_id` が NULL のものは共通シード30件 |
| `monologue_sessions` | `id`, `user_id`, `topic_id`, `mode`, `duration_sec`, `ja_memo`, `ai_suggestions`(jsonb), `used_phrase_ids`, `started_at` | 独り言1回分 |
| `recordings` | `id`, `user_id`, `kind`, `clip_id`, `monologue_session_id`, `storage_path`, `mime_type`, `duration_sec`, `created_at` | 音声本体は Storage、ここはメタデータ。**独り言は保存せず、リプロダクションの聴き比べ録音のみ** |
| `phrases` | `id`, `user_id`, `clip_id`, `text`, `meaning_ja`, `used_count`, `last_used_at`, `graduated_at`, `created_at` | **①と②を繋ぐ中核テーブル**。`graduated_at` が NULL の在庫だけが「今日使うフレーズ」に出る（初回使用で卒業） |
| `daily_activity`（ビュー） | `user_id`, `activity_date`, `reproduction_reps`, `monologue_sec`, `recording_sec` | 継続トラッキング用。`security_invoker = on` で RLS を継承 |

`monologue_topics` だけ SELECT ポリシーが `user_id is null or auth.uid() = user_id`（共通シードを全員が読む）。

**Storage** — `recordings` バケット（非公開）。パスは `<user_id>/<kind>/<uuid>.<ext>`。
`storage.foldername(name)[1] = auth.uid()` のポリシーで他人のフォルダに触れない。
リプロダクションの録音（聴き比べ用）だけをクライアントから直接アップロードし、Server Action はメタデータ行だけ作る（Blob をサーバに通さない）。**独り言の録音は保存しない**（時間だけ `monologue_sessions.duration_sec` に残す）。

### Annotation 型

`clips.transcript` を正とし、`annotations` はその**文字インデックス** `[start, end)` を参照する。

```ts
type Annotation = {
  id: string
  type: 'stress' | 'rise' | 'drop' | 'link' | 'flap_t' | 'reduction' | 'swallow'
  start: number   // 0起点
  end: number     // 排他
  surface?: string // reduction のときの実際の音（"gonna"）
  note?: string
}
```

**transcript を編集したら annotations は surface（覆っていた部分文字列）で新テキストへ貼り直す**（`reanchorAnnotations`）。消えた記号だけ落として件数を通知する。オフセットの機械的な追従はしない。

---

## 4. AI 連携

`src/app/api/ai/*` の Route Handler。すべて `src/lib/ai/run.ts` の `runStructured()` を経由する。

| エンドポイント | 入力 | 出力 | effort | max_tokens |
|---|---|---|---|---|
| `POST /api/ai/annotate` | `transcript` | `translation_ja`, `annotations[]` | `high` | 16000 |
| `POST /api/ai/explain` | `transcript`, `selection`, `question` | `headline`, `explanation`, `examples[{en, ja, when}]` | `high` | 16000 |
| `POST /api/ai/phrases` | `transcript` | `phrases[{text, meaning_ja, why}]` | `medium` | 8000 |
| `POST /api/ai/monologue-feedback` | `ja_memo`, `topic` | `suggestions[{text, meaning_ja, examples[]}]` | `medium` | 8000 |

**共通の約束事**

- モデルは `claude-opus-5`。`temperature` / `top_p` / `top_k` は 400 になるので渡さない
- `thinking` は省略して adaptive。`max_tokens` は思考＋本文の合計上限
- 深さとコストのレバーは `output_config.effort` だけ
- 構造化出力は `betaZodOutputFormat` + `client.beta.messages.parse()`
- `stop_reason === 'refusal'` を `content` を読む前に分岐し、422 で返す（`AiRefusalError`）
- `fallbacks: 'default'`（beta `server-side-fallback-2026-07-01`）を既定で有効
- システムプロンプト（`src/lib/ai/prompts.ts`）は `cache_control` でキャッシュする。**頻繁に編集するとキャッシュが無効化される**
- `annotate` は文字インデックスではなく **quote（該当部分の逐語コピー）＋ occurrence（何番目か）** を返させ、サーバ側で文字列照合してオフセットを復元する（LLM の整数オフセット誤差を原理的に避ける）。`resolveAiAnnotations`（`src/lib/annotation-anchor.ts`）を経由し、最後に `normalizeAnnotations` を通す

**音声認識は入れていない。** Claude API に音声入力はなく、Web Speech API は Chrome 限定で精度も不安定。
元動画自身が「録音は聞き返すためではなく可視化のため」と言っているので、日本語メモ → AI 変換のほうが忠実で確実だと判断した。
将来 Whisper を足す余地は `recordings` テーブルに残してある。

---

## 5. Server Actions

DB 書き込みは Server Action 経由（`src/app/actions/`）。

| ファイル | 関数 |
|---|---|
| `materials.ts` | `createMaterial`, `deleteMaterial` |
| `clips.ts` | `createClip`, `updateClip`, `deleteClip`, `logPractice` |
| `phrases.ts` | `addPhrases`, `markPhraseUsed`, `deletePhrase` |
| `monologue.ts` | `saveMonologueSession`, `saveMonologueFeedback`, `addCustomTopic` |
| `recordings.ts` | `saveRecording` |
| `profile.ts` | `updateProfile`, `signOut` |

戻り値は `ActionResult<T>`（`src/lib/action-result.ts`）。`'use server'` なファイルは async 関数しか export できないので型は別モジュールに置いてある。

---

## 6. 環境ごとの制約

実装・検証の過程で踏んだもの。同じ罠を避けるために残す。

| 制約 | 対応 |
|---|---|
| iOS Safari の MediaRecorder は `audio/mp4` | `isTypeSupported` で分岐。`audio/webm` 決め打ちにしない |
| バックグラウンド録音は不可 | 「1人電話」は Wake Lock で画面を保つ前提。非対応ブラウザでは警告を出す |
| `getUserMedia` が応答を返さないことがある | 15秒でタイムアウトして理由を表示する。無反応のボタンを残さない |
| YouTube IFrame の `end` はループしない | `requestAnimationFrame` で終端を監視して `seekTo` |
| `YT.Player` は渡した要素を iframe で置き換える | React の ref を直接渡さず使い捨ての子要素を挟む。iframe は 640×360 固定なので `[&>iframe]:size-full` で埋める |
| モバイルは `playsinline` 必須 | 初回再生はユーザー操作起点でないとブロックされる |
| YouTube 文字起こしの自動取得は不安定 | パネルからのコピペを正規動線にする |
| `font-mono`（Geist Mono）に日本語グリフがない | 「3回」「1日」「30秒」の単位は `font-mono` の外に出す。中に入れると豆腐になる |
| 選択範囲はボタンの mousedown で解除される | 注釈ツールバーは `onMouseDown` で `preventDefault()` する |

---

## 7. 検証状況

2026-08-01 時点。ローカル Supabase（Docker）を立てて実際に通した結果。

### 検証済み

| 対象 | 結果 |
|---|---|
| マイグレーション2本、8テーブル全RLS、Storageポリシー、お題30件 | 適用を確認 |
| **RLS の分離** | 別ユーザーを作って全テーブルを読み、0件を確認。共通お題だけ30件見える。`daily_activity` ビューも RLS を継承 |
| Magic Link ログイン → `profiles` 自動生成 | 通過 |
| YouTube URL 登録 → oEmbed でメタデータ取得 | 実在の動画で通過 |
| 区間の切り出し | 通過 |
| 文字起こしの貼付とタイムスタンプ除去 | 通過 |
| 選択 → 記号付与 → 保存 → 再読込 | 文字インデックスの正確さを確認（`d`=[3,4), `yet`=[54,57), `gonna`=[96,101)） |
| A-Bループの終端検知 → 回数カウント → `practice_logs` 記録 | 通過 |
| フレーズをタップ → `used_count` 加算 | 通過（①→②の受け渡し） |
| プロフィール保存とダッシュボードへの反映 | 通過 |
| ビルド / Lint / ユニットテスト20件 | 全通過 |

### 未検証

| 対象 | 理由 |
|---|---|
| **AI エンドポイント4本** | `ANTHROPIC_API_KEY` 未設定のため実行していない。型・スキーマ・refusal 分岐はコード上は確認済み。`annotate` は quote 照合方式に変え、整数オフセット誤差は原理的に回避したが、**AI が quote を逐語一致でコピーできるかは実行して確かめる必要がある** |
| **録音の実機保存**（Storage アップロード＋メタデータ行） | ヘッドレスブラウザにマイクがないため |
| 実機のモバイル（iOS / Android）での動作 | 未実施 |

### テスト

`npm test` は `node:test` で `tests/*.test.ts` を実行する（20件）。
外部依存のないロジックだけを対象にしている。

- 文字起こしの整形（タイムスタンプ除去、文分割とオフセットの一致）
- 注釈の正規化（範囲外・空範囲・未知種別・重複IDの排除）
- 連続日数とヒートマップ（月・年またぎ、今日未着手の扱い）
- YouTube URL の解釈（各種形式、不正入力）
