# repro-talk — リプロダクション＋独り言の英語学習アプリ

> 画面ごとの機能・データモデル・AIエンドポイント・検証状況は [`docs/spec.md`](docs/spec.md) にある。
> このファイルは**なぜそうしたか**と、コードを触るときの約束事を扱う。

## プロジェクト概要

YouTube動画「【結論！】英語が話せなかった私が1年未満でペラペラになったたった1つの方法」（Nanami / ななみ, @nanamin_english）の学習法を、1人で継続できるようにするWebアプリ。

### 方法論（これがアプリの仕様の源）

英語学習に必要なのは2つだけ。

1. **リプロダクション** — 完成された英語を「100のまま」受け取る
   - ネイティブの生音声を1文再生 →**止めて**→ 自分で同じように発音（シャドーイングと違い音が被らないので誤魔化せない）
   - 素材レベル：L1 和訳付きフレーズ動画 → L2 英語学習者向け英語チャンネル → L3 興味分野の海外チャンネル → L4 ドラマ・映画
   - 30秒の尺を選ぶ → 文字起こしをコピー → 大意を把握 → 紙に行間を空けて書き出す → **カラーペンで音の記号を書き込む** → 疑問を解く → 0.5〜0.75倍速で「音を顕微鏡で見る」→ 再現練習 → 慣れたら耳だけ
   - 記号は7種：強勢の山／上がる矢印／脱落の×／リンキングの連結線／フラップTの丸／短縮(gonna)／飲み込む音

2. **独り言** — 自力で「0から」英語を作り出す
   - 単語 → 自分の状態 → 文に膨らませる → トピックを決めて話す → **リプロダクションで覚えたフレーズを独り言で使う（ここで0と100が繋がる）**
   - 録音をONにするのは「やった事実の可視化」のため。まず1分から
   - 最強の型は「**1人電話**」＝外を歩きながら電話のフリをして話し続ける
   - お題30個＝1日1個で1ヶ月

3. **継続の本質** — 「いかに自分を楽しませ続けるかという自分との心理戦」。伸びるのは〈英語の先に理解したい何かがある人〉。`profiles.why_text` をホームに常時出しているのはこのため。

### このアプリが担保すること・しないこと

- **担保する**：習慣化と可視化。紙とペンの代替（マーキング・エディタ）。ChatGPTへの手動コピペの内製化。0と100を繋ぐフレーズの受け渡し。
- **担保しない**：「1年でペラペラ」という成果。動画は個人の体験談で再現性の担保はない。
- **やらない**：YouTube音源のダウンロード・切り出し（ToS違反）。発音の自動採点（精度が出ず、誤った採点はユーザーを害する）。

## 使用技術

- **フレームワーク**: Next.js 16 (App Router) / TypeScript
- **UI**: shadcn/ui (base-ui, style `base-nova`) + Tailwind CSS v4
- **DB / 認証 / ストレージ**: Supabase
- **AI**: Claude API (`@anthropic-ai/sdk`, モデルは `claude-opus-5`)
- **デプロイ**: Vercel

## UIルール

- 新しい部品は必ず `npx shadcn@latest add` から追加する
- base-ui ベースなので合成は `asChild` ではなく `render` プロップ
- 文言は日本語。学習者を急かさない・煽らないトーン
- `/monologue` は「歩きながらスマホ片手」を最優先。タップ領域を大きく

## 主要な構造

```
supabase/migrations/     0001 スキーマ+RLS+Storage / 0002 お題30件 / 0008 学習時間の計測 / 0009 週の目標 / 0010 発音記号
src/proxy.ts             Supabase セッション更新 + 未ログインを /login へ（旧 middleware.ts）
src/app/(app)/           認証必須のページ群
src/app/api/ai/*         Claude API を叩く Route Handler（proxy の matcher 対象外なので各自で認証）
src/app/actions/*        Server Actions（DB 書き込み）
src/components/player/   YouTube IFrame Player API のラッパ
src/components/annotation/ 発音マーキング（紙とペンの代替）
src/components/workspace/  リプロダクション・ワークスペース
src/components/monologue/  独り言モード
src/components/study/      学習時間の計測（開始/終了・計測中バー・記録の修正）
src/lib/ai/              Anthropic クライアント・プロンプト・構造化出力ランナー
src/lib/activity.ts      連続日数・ヒートマップ・週の目標（日付境界は Asia/Tokyo 固定）
src/lib/study.ts         学習時間の純粋ロジック（JST の読み書き・時間の整形）
src/lib/study-server.ts  学習時間のサーバ読み取り（Server Action に置くと公開される）
```

## Claude API の約束事

`src/lib/ai/run.ts` の `runStructured()` を必ず経由する。直接 SDK を叩かない。

- モデルは `claude-opus-5`。`temperature` / `top_p` / `top_k` は **400 になるので渡さない**
- `thinking` は省略で adaptive がON。`max_tokens` は思考＋本文の合計上限
- 深さとコストのレバーは `output_config.effort` だけ。annotate/explain は `high`、抽出系は `medium`
- **`max_tokens` は 21,333 が上限**。`runStructured()` は非ストリーミングで、SDK が `60 * 60 * max_tokens / 128000` から所要時間を見積もり、10分を超える見込みだと**投げる前に例外**にする（`Streaming is required for operations that may take longer than 10 minutes`）。件数の多い生成でもここを超えない
- `stop_reason === 'refusal'` を `content` を読む前に必ず分岐する（`AiRefusalError`）
- システムプロンプト（`src/lib/ai/prompts.ts`）は `cache_control` でキャッシュしている。**頻繁に編集するとキャッシュが無効化される**
- 構造化出力は `betaZodOutputFormat` + `client.beta.messages.parse()`

## 設計上の注意

- **発音記号（`clips.ipa`）も transcript の文字インデックス参照**。語をキーにした辞書にはしない（同じ語が何度も出るうえ read / live を取り違える）。AI には語＋IPA を出現順に返させ、サーバで単語に切って前から突き合わせる（`resolveAiPronunciations`）。生成は `/api/ai/ipa` として annotate とは**別の呼び出し**にする（発音記号が欲しいだけのときに、手で付けた記号を annotate が丸ごと差し替えてしまわないように）。表示は練習中の1文カードだけ・既定は非表示
- **annotations は transcript の文字インデックス参照**。transcript を編集したら、覆っていた部分文字列で新テキストへ貼り直す（`reanchorAnnotations`、`src/lib/annotation-anchor.ts`）。消えた記号だけ落とす。機械的なオフセット追従はしない
- **AI 解析（annotate）は quote＋occurrence を返させ、サーバ側で文字列照合してオフセットを復元する**（`resolveAiAnnotations`）。LLM は整数オフセットが不安定なので index は信用しない。最後に `normalizeAnnotations()` を最終防波堤として必ず通す
- リプロダクション回数は「1回再生して止める→**言えた**」のタップで数える（聴くだけ・ループは数えない）。**独り言の録音音声は保存しない**（時間だけ記録）。フレーズは**初回使用で卒業**して「今日使うフレーズ」から外れる
- **瞬間英作文の「応用」は新テーブルを作らず `compositions.source='ai'` で持つ**。★・読み上げ・回数記録・中断と再開・編集・削除が既存のまま効く。組み合わせる2〜3文は**サーバ側で束ねてから AI に渡す**（コース全文を渡して選ばせると前の方の文ばかり拾う）。**ネタ元は `source='manual'` だけ**（応用をさらに材料にすると AI が自分の出力を再加工してコースの型から離れる）。**AI の出力を無検品でコースに入れる導線は作らない**——答えの英語はドリル中に「正解」として読み上げられるので、採否は1件ずつ本人が決める（発音の自動採点をしないのと同じ理由）
- **学習時間の経過はカウンタを持たず、`started_at` と今の差で毎回計算する**。ページ遷移・リロード・アプリの切り替えを跨いでも狂わない。計測中は同時に1本だけ（部分ユニーク索引で担保）で、別の学習を開始すると前の1本を閉じてから始める。計測中バーは `(app)` レイアウトが持ち、下部ナビと**同じ入れ物**で貼り付ける（2つの要素を別々に `sticky bottom-0` にすると重なる）
- **終了ボタンを押し忘れた行は 0分 で締めて印（`auto_closed`）を付ける**。それらしい時間を作らない。`study_sessions.duration_sec` は生成列なので、あとから直すときは時刻のほうを動かす（「開始19:00・終了19:30・45分」のような矛盾した行を作れない）。**`study_sec` と `monologue_sec` は同じ時間が重なる**ので、表示でも集計でも足し合わせない（ヒートマップの分の項は大きいほうだけを採る）
- **`'use server'` のファイルに読み取りを置かない**。export がすべて公開エンドポイントになる。サーバコンポーネント専用の読み取りは `src/lib/*-server.ts` に置く
- **ホームの「今週」は月曜始まりの暦週で統一する**（`weekStartJst()`）。目標のためにローリング7日と混ぜると、同じ画面で「今週」が2つの意味になり、達成率も日が進むだけで目減りする。**`profiles.weekly_goal_sec` の 0 は未設定**で、既定値を置かない（本人が決めていない数字に対して未達を出し続けない）。`daily_goal_sec`（1日の独り言＝声を出す時間）とは別の軸なので列を分ける
- **iOS Safari の MediaRecorder は `audio/mp4`**。`isTypeSupported` で分岐済み。`audio/webm` 決め打ちにしない
- **バックグラウンド録音は不可**。「1人電話」は Wake Lock で画面を保つ前提
- **YouTube IFrame の `end` はループしない**。`requestAnimationFrame` で終端を監視して `seekTo`
- **サーバー側での文字起こし自動取得はしない**。timedtext 経路はデータセンターIP（Vercel）が強くブロックされ、ブラウザ直叩きは CORS で塞がっている。代わりに**ユーザーのブラウザで動くブックマークレット**（`src/lib/transcript-bookmarklet.ts`）が字幕を `m:ss テキスト` でクリップボードへ入れ、それを貼り付ける。手動コピペ（「文字起こしを表示」）もフォールバックとして残す。全文を貼っても clip の `[start, end)` で `trimTranscriptToRange` が区間に絞る
- リプロダクションの録音（聴き比べ用）だけクライアントから直接 Storage にアップロードし、Server Action ではメタデータ行だけ作る。独り言の録音は上げない
- **`getUserMedia` は応答が返らないことがある**。`useRecorder` は15秒でタイムアウトして理由を出す（無反応のボタンを残さない）
- **`font-mono`（Geist Mono）に日本語グリフはない**。「3回」「1日」「30秒」のような単位は必ず `font-mono` の外に出す。中に入れると豆腐になる
- 注釈ツールバーのボタンは `onMouseDown` で `preventDefault()` する。しないと mousedown で選択が解除され、onClick 時に範囲を失う
- `YT.Player` は渡した要素を iframe で**置き換える**ので、React の ref を直接渡さず使い捨ての子要素を挟む。iframe は 640x360 固定なので `[&>iframe]:size-full` で埋める
- **ローカルの Supabase はメールを外に出さない**（Mailpit に溜まる）。ローカル固有の案内は `src/lib/local-dev.ts` の `localMailboxUrl()` で出し分ける。`NEXT_PUBLIC_SUPABASE_URL` のホスト名で判定し、クラウド接続時は何も出さない

## ローカル開発

`supabase start` でローカル Supabase が立つ（Docker が必要）。`supabase/config.toml` は
`site_url` を `http://localhost:3000` に、`edge_runtime` を無効に設定済み。
Magic Link のメールは Mailpit（http://127.0.0.1:54324）で受ける。

`npm test` は `node --test --experimental-strip-types` で `tests/*.test.ts` を実行する。
外部依存のないロジック（文字起こし整形・注釈の正規化・連続日数・URL 解釈）だけを対象にしている。

## 開発方針

- 仕様が曖昧なときは grill-me で詰めてからコードを書く
- 実装前にプランモードで設計を確認する
- 自分専用ツールとして開発開始
