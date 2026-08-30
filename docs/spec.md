# repro-talk 仕様

実装後の姿に合わせて書いてある。設計判断の背景は [`../CLAUDE.md`](../CLAUDE.md)、セットアップと使い方は [`../README.md`](../README.md) を参照。

---

## 1. 何のためのアプリか

YouTube動画「【結論！】英語が話せなかった私が1年未満でペラペラになったたった1つの方法」（Nanami / ななみ, [@nanamin_english](https://www.youtube.com/@nanamin_english)）で説明されている学習法を、1人で継続するための道具。

学習法の主張は「必要なのは2つだけ」というもの。

1. **リプロダクション** — 完成された英語を「100のまま」受け取る
2. **独り言** — 自力で「0から」英語を作り出す

そして、①で入れた表現を②で口から出せたときに両者が繋がる。アプリはこの3つをそのまま3本の導線にしている。

リプロダクションの素材は2系統ある。**YouTube 動画から切り出したクリップ**（元動画の方法そのまま）と、**自分で登録したテキスト**（ニュース・本の一節、あるいは自分で書いてAIで自然に整えた英文）。後者はクラウドTTSで読み上げ、同じ「1文ずつ止めて再現する」ワークスペースで練習する。動画音源のDL・切り出しをしない原則（後述）を守りつつ、L1〜L4の適した動画が見つからない題材や、独り言で言えなかった表現を"完成形"にして再現する導線を足すもの。自作の学習者英語は必ずしも"100"ではないため、任意でAI推敲を挟んで「完成された英語を100のまま受け取る」原則を保てるようにする（原文は残す）。

さらに、元動画の「必要なのは2つ」には**含まれない**補助輪として、森沢洋介式の**瞬間英作文**ドリルを足した（4本目の導線）。日本語を見た瞬間に英語を口から出す訓練で、①で受け取った表現・②で作った表現を「型」として登録し、反射で言えるまで回す。①→②の受け渡しをフレーズ単位で下支えする位置づけ。「成果は担保しない・自動採点はしない」の原則はそのままで、答えは自己採点、画面表示＋音声読み上げはあくまで参照用。

### 担保すること / しないこと

| | |
|---|---|
| **担保する** | 習慣化と可視化。紙とペンでやっていた音の書き込みの代替。ChatGPTへの手動コピペの内製化。①→②のフレーズの受け渡し。動画に頼らずに再現できる自作テキスト素材（クラウドTTSで読み上げ） |
| **担保しない** | 学習成果。元動画は個人の体験談で再現性の担保はなく、末尾は公式LINEへの誘導になっている |
| **意図的にやらない** | YouTube音源のダウンロード・切り出し（利用規約違反）。発音の自動採点（精度が出ず、誤った採点は学習者を害する）。音声認識（後述） |

---

## 2. 画面と機能

### 画面遷移

```
/login ──(Magic Link)──> /auth/callback ──> /
                                             │
   ┌────────────┬────────────┬───────┴────┬────────────┐
   │            │            │            │            │
/materials  /monologue  /compositions  /phrases    /settings
   │                         │
   │                    /compositions/[id] ──(スタート)──> プレイヤー
   │                                        （日本語→考える→答え表示＋読み上げ→再現の間→次…）
   │
/materials/[id] ──(区間を切り出す)──> /clips/[id]  （YouTube・A-Bループのワークスペース）
   │                                      │
   │                                （フレーズ抽出）
   │                                      └──> /monologue の「今日使うフレーズ」へ
   └──(テキストを登録／任意でAI推敲)──> /clips/[id]  （自作テキスト・文単位＋TTSのワークスペース）
```

`/clips/[id]` は同じルートで、クリップの `source`（`youtube` / `text`）で左カラム（プレイヤー）を出し分ける。右カラム（スクリプト・マーキング・解説・フレーズ抽出）は共通。

認証は `src/proxy.ts`（Next.js 16 の Proxy。旧 `middleware.ts`）で全ページを保護する。
`/api/` 以下は matcher の対象外なので、各 Route Handler が自分で認証する。

### 待ち時間の見せ方（共通ルール）

待たせるものが3種類あり、それぞれ別の出し方をする。**「文字が変わるだけ」は使わない**（スマホだと変化に気づけず、押せていないのか固まったのか分からない）。

- **ページ遷移**：`(app)` 配下は全ページ `force-dynamic` で Supabase を叩くため、遷移のたびにサーバを待つ。`src/app/(app)/loading.tsx` の骨組み（`Skeleton`）が即座に差し変わって「読みに行っている」ことを示す。加えて、**タップしたナビのアイコンをその場でスピナーに差し替える**（`useLinkStatus`。Link の子孫でしか使えないので `NavIcon` を切り出している）。スケルトンはサーバ応答後、ナビのスピナーはタップ直後から出るので、片手操作でも「押せた」がすぐ分かる
- **短い処理（Server Action の保存・削除・追加）**：`useTransition` の `pending` でボタン内にスピナーを出す。アイコン付きのボタンはアイコンをスピナーへ差し替え、無いボタンは先頭に足す。スピナーは `src/components/ui/spinner.tsx`（shadcn）に統一し、手書きの `Loader2 + animate-spin` は残さない
- **長い処理（Claude を叩く解析・推敲・質問・フレーズ抽出）**：ボタンのスピナーに加えて、**待ち時間の目安を1行出す**（「AI が音の記号を付けています。10〜30秒ほどかかります。」）。秒単位で待つものはスピナーだけだと止まって見える
- **読み上げ（TTS）**：初出の文はサーバで MP3 を生成するぶん数秒待つ。`speaker.speak()` は `onstart`（実際に音が出はじめた時点）を返し、瞬間英作文のプレイヤーはそれまでを「音声を準備中…」＋スピナー、鳴りはじめてから「読み上げ中…」と出し分ける

### 学習時間の計測（全画面共通）

「どれだけやったか（回数・話した時間）」とは別に、**机に向かっていた時間**を計る。
各学習ページの**開始**ボタンで1行作り、**終了**で閉じる（`study_sessions`）。

- **経過時間はカウンタを持たず、`started_at` と今の差で毎回計算する**。ページ遷移・リロード・アプリの切り替えを跨いでも狂わない
- **計測中は同時に1本だけ**（`study_sessions` の部分ユニーク索引で担保）。別の学習で開始すると、前の1本を閉じてから始める（ボタンは「切り替えて開始」になる）
- **計測中バーは `(app)` レイアウトが持つ**。下部ナビと同じ入れ物で画面下に貼り付き、どのページからでも終了できる（学習中に素材一覧へ戻る・瞬間英作文のプレイヤーへ入る、が普通に起きるため）
- 対象は3本の導線すべて（`kind`: `reproduction` / `monologue` / `composition`）。独り言の録音タイマーは「声を出していた時間」で別物。**両方を残し、集計では足し合わせない**

**終了ボタンの押し忘れ**への備えが2段ある。

1. **6時間を超えたら警告**（`STUDY_STALE_SEC`）。計測中バーが「終了し忘れかもしれません」に変わる
2. **6時間超で終了／次の開始をしたら 0分で締めて印を付ける**（`auto_closed`）。本当に何分やったかは誰も知らないので、それらしい時間を作らない。印の付いた行はダッシュボードの「学習の記録」に「終了し忘れ」として出て、本人が実際の時間に直す

### `/` ダッシュボード

| 要素 | 内容 |
|---|---|
| Why バナー | `profiles.why_text`（英語の先に理解したい何か）を常時表示。未設定なら設定への誘導 |
| 今日やること | リプロダクション（作りかけのクリップ、無ければ新規切り出しへ）／独り言／瞬間英作文（コースを選んで流す）。当日完了なら「今日済み」バッジ。各カードに**その導線の今日の学習時間** |
| 今週の学習（目標） | `profiles.weekly_goal_sec` に対する進捗。学習時間／目標・パーセント・進捗バー（**ペース目盛り付き**）・残り時間とあと何日・1日あたりの必要量・曜日ごとの棒グラフ。達成したら緑＋超過ぶんを出す。**目標未設定（0）なら**今週の学習時間だけを出して設定へ誘導する |
| 続いている記録 | 連続日数、今週の独り言の合計時間、今週のリプロダクション回数、今週の瞬間英作文回数 |
| ヒートマップ | 直近12週 × 7日。当日はリング表示、未来日は薄く |
| 学習の記録 | 直近14日の学習セッション明細（日付ごと・合計つき）。行の鉛筆から**開始時刻と学習時間（分）を直す／削除**。「終了し忘れ」は先頭にまとめて件数を出す |
| フレーズの残 | まだ使っていないフレーズ件数と、独り言への誘導 |

**「今週」は月曜始まりの暦週**（`weekStartJst()`）。目標も上の3つの「今週の…」も同じ区切りで、画面内で「今週」の意味を1つにする（ローリング7日と混ぜない）。
週の目標のペースは「今日の終わりまでに `目標 × 経過日数 / 7`」。遅れているときだけ目安を出す。
週の学習時間は `daily_activity.study_sec` の合計＝**開始/終了で計った時間**で、独り言の「話した時間」とは別。

連続日数は「今日まだ何もしていなければ昨日から数える」。日付が変わるまでは途切れ扱いにしない。
瞬間英作文だけをやった日も、**学習時間だけを記録した日**も「動かした日」に含める。
ヒートマップの濃さは `リプロ回数 + max(学習時間, 独り言の時間)/60 + 英作文回数`。
**分の項は大きいほうだけを採る**（独り言も学習時間の計測に乗るので、足すと同じ時間を二重に濃くしてしまう）。
日付境界は **Asia/Tokyo 固定**（`daily_activity` ビューと `src/lib/activity.ts` の両方）。
学習時間を**あとから直す**ときも JST を明示して解釈する（`jstIsoFrom()` が `+09:00` を付ける）ので、端末のタイムゾーンに依らない。

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

**自作テキスト区分** — L1〜L4 の動画とは別枠で、同じページに「自作テキスト」セクションを持つ。ここは動画（`materials`）を挟まず、`source='text'` のクリップを直接一覧する（各カードは `/clips/[id]` へ。親 material を持たないフラットな並び）。

「テキストを登録」ダイアログ：
- **タイトル**（任意。クリップの `label` になり、一覧に出る）と **本文**（英語のテキストを貼る／打つ）を入れる
- **任意で「AIで自然にする」**（`POST /api/ai/naturalize`）。元文と推敲後を並べて確認し、採用すると `transcript`＝推敲後・`source_text`＝元文になる。使わなければ `transcript`＝元文・`source_text`＝NULL。自作の学習者英語を"完成された英語"にしてから再現するための一手間で、外部のネイティブ文章（記事・本の一節など）を貼るときは使わなくてよい
- 登録すると `source='text'` のクリップを作り、そのままワークスペース（`/clips/[id]`）へ遷移する

削除は一覧のクリップから直接（`deleteClip`。親 material が無いので materials とは独立に消える）。

### `/materials/[id]` 区間の切り出し

動画を再生しながら「ここから」「ここまで」を打ってクリップを作る。
30秒が目安で、45秒を超えると注意を出す。作る前に区間をループ再生して確認できる。

### `/clips/[id]` リプロダクション・ワークスペース（中心画面）

紙とペンの代替。左（プレイヤーと録音）／右（スクリプトと解析）の2カラム。
クリップの `source` で左カラムを出し分ける（`youtube` / `text`）。右カラム（スクリプト・発音マーキング・録音と聴き比べ・解説とフレーズ）は共通で、`clips` テーブルを共有するので注釈・フレーズ抽出・録音・回数記録もそのまま両系統で使える。

**プレイヤー（`source='youtube'` — YouTubeクリップ）**

- 区間の A-B ループ。`end` パラメータはループしないので `requestAnimationFrame` で終端を監視して `seekTo` する
- **「1回再生して止める」** — 区間の終わりで自動停止する。リプロダクションの中核操作（シャドーイングとの違い）
- 再生速度 `0.5 / 0.75 / 1.0`。0.5倍速は「音を顕微鏡で覗く」用
- 「1回再生して止める」→ 自分で同じように言って **「言えた」** を押すとリプロダクション回数が増え、`practice_logs` に自動記録される。ループ再生・聴くだけは数えない（測るのはリスニング回数ではなく**再現した回数**）

**プレイヤー（`source='text'` — 自作テキスト）**

動画が無いので、YouTube プレイヤーの代わりに **クラウドTTS を鳴らす「文単位プレイヤー」** を置く。方法論の「1文ずつ止めて再現する」に忠実に、テキストを**文単位で回す**。

- スクリプトを `splitSentences()`（`src/lib/transcript.ts`・既存）で文に分け、いま練習する文を1つ大きく出す（何文中の何文目かも表示）
- **「1文再生して止める」** — その文の TTS 音声（`<audio>`）を鳴らし、末尾で自然に止まる（YouTube のような打ち切りの `requestAnimationFrame` 監視は不要）。音声は `POST /api/tts`（既存・変更なし）で1文ずつ取得。文は必ず `MAX_LEN=500` に収まる
- 再生速度 `0.5 / 0.75 / 1.0` は **`<audio>.playbackRate`（`preservesPitch=true`）** で効かせる。TTS を速度別に再生成しない（キャッシュを汚さない）。0.5倍速でもピッチが保たれ、YouTube 側と同じ「音を顕微鏡で覗く」体験になる
- 「1文再生して止める」→ 自分で言って **「言えた」** で1回と数え、`practice_logs` に記録して**次の文へ**進む。**「もう一回」**は数えず同じ文を鳴らし直す。最後の文の「言えた」で1周（クリップ単位のカウント設計は YouTube と同じ＝`clip_id` 単位の `practice_logs`）
- 体感遅延を消すため、いまの文を鳴らしている間に**次の文の音声をプリフェッチ**する（`speaker.ts` の `prefetch` と同じ考え方。ただしワークスペースは聴き比べ用に自前の `<audio>` を持つので専用の取得経路にする）
- iOS の `<audio>` 解錠（無音再生を gesture 内で）は独り言・瞬間英作文と同じ。TTS 不可（`OPENAI_API_KEY` 未設定・生成失敗）のときは録音・聴き比べだけが使えず、マーキング等は通常どおり使える

**スクリプト**

スクリプトを貼り付ける。取得は2通り：**「字幕を取得」ブックマークレット**（ブックマークバーにドラッグして登録し、YouTube の動画ページで押すと字幕を `m:ss テキスト` でクリップボードへ入れる）か、従来どおり「文字起こしを表示」からの手動コピペ。**サーバー側の自動取得はしない**（timedtext はデータセンターIPが強くブロックされ、ブラウザ直叩きは CORS で塞がっているため）。ブックマークレットはユーザーのブラウザ・セッションで動くのでブロックを受けず、音源DLもしない。
ブックマークレットで動画全体を貼っても、「この区間だけ切り出す」で clip の `[start, end)` に重なる字幕行だけへ絞れる（`trimTranscriptToRange`。各キューの終端は次キューの開始で近似し、区間開始をまたぐ字幕も残す）。「タイムスタンプを除去」は `0:00` / `[00:12]` / `(1:02:03)` / 単独行のタイムスタンプと `[音楽]` 等を落とし、字幕の途中改行を連結する。

`source='text'` のクリップでは、スクリプトは登録した本文そのもの（ブックマークレット・区間絞り込みは対象外）。ここでも **「AIで自然にする」**（`POST /api/ai/naturalize`）を後から実行でき、採用すると `transcript` を推敲後へ差し替える。このとき注釈は「貼り直す」と同じく `reanchorAnnotations` で surface（覆っていた部分文字列）を頼りに新テキストへ貼り直し、消えた記号だけ落とす（元文は `source_text` に残す）。

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
お手本は `source='youtube'` なら区間の音声、`source='text'` なら**いま練習している文の TTS 音声**。どちらも「1回だけ鳴らして自分に渡す」点は同じ（録音・聴き比べは `recordings` に `kind='reproduction'` で保存。text クリップも `clip_id` で紐づく）。

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

### `/compositions` 瞬間英作文

日本語を見た瞬間に英語を作る反射のドリル。**コース**（例文の束）を作り、選んで流すと日本語→答え→次…と自動で進む。トップの「今日やること」とヘッダー（デスクトップは上部ナビ、モバイルは下部ナビ）から入れる。

**コースと例文の管理**（`/compositions` 一覧 → `/compositions/[id]` 詳細）

- コースの CRUD（タイトル＋任意の説明）。コース内に例文を任意の数ぶら下げられる
- 例文の CRUD。例文は `ja`（日本語）＋`en`（英語）の対。1件ずつの追加・編集・削除ができる。各行に**読み上げ（再生）ボタン**があり、その文の英語をその場で読み上げる（同じ行でもう一度押すと停止、別の行を押すと切替）
- **★（重点マーク）**：各例文の行で ★ をトグルできる（プレイヤーのドリル中にも同じ ★ を切り替えられる＝後述）。★ は「**まだ言えない・重点的に練習したい**」印で、言えるようになったら外す。得意/不得意の永続ラベルではなく、練習対象を絞るためのフラグ。管理見出しに **★ の件数**を出す。状態は `compositions.starred` に持ち、トグルは新アクションを足さず `updateComposition`（`starred` を渡す）を再利用する
- **CSV で一括登録**：1行 = `日本語,英語`。文にカンマ・引用符が入る前提で RFC4180 のクオート（`"..."`）を解し、**タブ区切り**（スプレッドシートからの貼り付け）も受ける。ヘッダー行は任意。既存コースへ追記する

**流す（プレイヤー）** — スタート前に選ぶ

| 設定 | 選択肢 | 既定 |
|---|---|---|
| 対象 | 全部 / ★のみ | 全部 |
| 順番 | 登録順 / ランダム | 登録順 |
| 切り替え速度 | 3〜15秒（任意の整数秒） | 10秒 |

- **対象＝★のみ** を選ぶと、★を付けた例文だけを流す。「もう言えるものは飛ばし、言えないものに絞る」ための導線。選択肢には ★ の件数を併記し、★が **0件**のときは「★のみ」を選べない（＝スタートできず、先に ★ を付けるよう促す）

- 開始すると日本語が1文だけ大きく出る → 設定秒だけ「考える時間」（**残り時間ゲージ**が左詰めで減っていく／CSSアニメ） → **答え（英語）を表示し、同時に読み上げる** → 読み上げが終わったら**声に出して再現する間（約3秒・細いゲージで残りを表示）** → 次の文へ。これをコースの文章数だけ繰り返して1周で終わる。答え表示中はラベルを「読み上げ中…」→「声に出して再現」と出し分け、次に進むことを予告する
- **画面の真ん中（本体エリア）のタップは一時停止／再開**、**送りはフッターのボタンだけ**が担う。歩きながら片手で押す前提だと、一番大きい当たり判定を「止める」に割り当てたほうが役に立つ（送りは待っていれば自動で進むが、止めるのは自分で押すしかない）。ヘッダーの一時停止ボタンは状態表示も兼ねて残す
- **フッターのボタンは「答えを確認してから次へ」に統一する**。考える時間の途中で押すと、待たずに今の文の答えを表示＋読み上げし、読み終えて（`onend`／保険タイマー）から**再現の間を挟んで**次へ進む。答え表示中（読み上げ中・再現の間とも）に押すとすぐ次へ。**答えを見ずに文を飛ばす手段は持たない**（瞬間英作文は「日本語→口に出す→直後に正解を確認」の訓練なので、答えのスキップはしない）。ボタン名は考える時間中「答えを見る」／答え表示中「次へ」で出し分ける。スマホでは全幅＋高さ `h-14` の丸ボタンにし（独り言の大ボタンと同じ考え方）、`env(safe-area-inset-bottom)` ぶん下に余白を足す。**一時停止中でも押せる**（押すと止まりを解いてから送る＝押しても無反応にならない）
- **1つ前に戻る**：フッターの送りボタンの左に戻りボタン（`ChevronLeft`）を置く。聞き逃した／もう一度自力で作り直したい文へ1つ下がる。**戻った先は「考える時間」から**始める（すぐ答えを聞きたいなら「答えを見る」で飛ばせるが、答えから始めてしまうとその文をもう一度自力で作るという肝心の練習ができなくなる）。先頭の文では無効。一時停止中に押すと止まりを解いてから戻る（送りと同じで、押して無反応にはしない）。**完了画面からも「最後の文へ」で戻れる**（最後の1文を聞き逃したまま1周終わってしまう逃げ場が無くなるため。`index` は動かさず完了状態だけ解いて Wake Lock を取り直す）。再表示ぶんの回数は改めて記録する（もう一周と同じ扱い＝実際に声に出した回数を数える）。スマホでは送りボタンと同じ高さの丸ボタン（`size-14`）にして片手で押せるようにする
- **送り／戻りで古い読み上げに割り込ませない**：読み上げ〜再現の間には「世代」（`runRef`）を振り、送り・戻り・停止・もう一周のたびに進める。`speechSynthesis` は `cancel()` でも `end` を飛ばすので、これが無いと**古い文の `onend` が後から届いて次の文のタイマーを奪う**（次の文の考える時間が数秒で切られたまま止まる）
- **ドリル中の★トグル**：プレイヤーにも ★ ボタンを常時（考える時間・答え表示中とも）置き、いま表示している文の `starred` をその場で切り替える。「言えなかった」と分かった瞬間に印を付けられるのが狙い。**タップはトグルのみで、答え表示も次への送りも一時停止も起こさない**（本体タップとは別の当たり判定）。切り替えは `updateComposition({ starred })` で即保存し、ボタンの見た目（塗り/枠）へ楽観的に反映する。**★のみで流している最中に外しても、その run は開始時の並びを最後まで流す**（`starred` の変更が効くのは次回以降の対象選択と一覧のみ）。退出時の `router.refresh()` で一覧の★件数にも反映される
- 読み上げは**クラウドTTS**。サーバ（`POST /api/tts`）が OpenAI TTS で MP3 を生成し、公開バケット `tts` に content-hash 名でキャッシュして URL を返す。同じ文は2回目以降は生成せず即返る。クライアントは単一の `<audio>` 要素（スタートの gesture で解錠）で再生し、考える時間中に今の文＋次の文をプリフェッチする。次への送りは `ended`（保険タイマー併用）。**`speechSynthesis` は使ううちに固まって無音化する**（要ブラウザ再起動）ため主経路から外した。`OPENAI_API_KEY` 未設定・生成失敗・再生ブロック時のみ `speechSynthesis` にフォールバックする（`src/lib/speaker.ts`）
- 「歩きながら・見ずに口だけ」を許すため Wake Lock を張る（独り言と同じ）。iOS はユーザー操作を起点にしないと発話がブロックされるので、スタート押下時に無音の発話で一度解錠しておく。ドリル前に音が出るか確かめられる **「声のテスト」ボタン**もスタート画面に置く
- **一時停止（小休憩）**：ヘッダーの一時停止ボタン（× の左）でセッション内で止められる。考える時間で止めた場合は**止めた位置から続き**を再開する（ゲージは `animation-play-state` で凍結して継続、JS 側は `performance.now()` の締切から残り時間を割り出して張り直す）。答えの読み上げ中・再現の間に止めた場合は再開時に**その文を頭から読み直す**（再現の間もやり直す。`speechSynthesis.pause()/resume()` は端末差が大きく不安定なため、`cancel()`→読み直しにする）。停止中も**画面全体が「再開」の当たり判定**（＝本体タップのトグルそのもの）。ただし**英文は覆わない**：止めるのは英文をじっくり見たいときなので、全面オーバーレイはやめ、上端の小さなピル（「タップで再開」）と小さなラベルだけで示す。代わりに停止中は**英文を大きく**（`text-2xl`／`sm:text-4xl`）、日本語を一段落として英文を主役にする。答えの折り返しを減らすため本体の幅は `max-w-2xl`（ゲージだけ `max-w-md` に留める）。Wake Lock は停止で解放し再開で取り直す
- **中断と再開**：× で止めると、その run の**再生順（例文 id の並び）＋位置**をコース単位で localStorage に保存し、待受に「続きから／最初から」を出す。ランダム順や「★のみ」で始めても続きが成立するよう並びごと保存する（再開は保存した並びを再生するだけで、現在の「対象」設定に依らない）。例文が消えて並びがズレた保存は自動で破棄し、1周し切ったらクリアする（一時停止は run 内で止めるだけで、この localStorage 保存とは別物）
- 最後の設定（対象・順番・秒数）も localStorage に覚える。設定・中断位置とも DB には持たない

**継続への反映**

- 1文を表示・読み上げるたびに **1回** と数え、その都度 `composition_logs` に `rep_count: 1` で記録する（バッチにせず即記録）。途中で止めても、そこまで再生した数はすべて残る。`/` は force-dynamic で毎回引き直すため `logCompositionReps` は `revalidatePath` しない
- 日毎の回数を `daily_activity.composition_reps` に集計し、ダッシュボードの「続いている記録」に**今週の瞬間英作文回数**を出す
- **瞬間英作文だけをやった日も連続日数に数える**（`hasActivity` が `composition_reps > 0` を含む）。ヒートマップの濃さにも加算する

### `/settings`

- **英語の先に理解したい何か**（`why_text`）— 継続の芯としてホームに常時出す
- **1日の独り言の目標**（1分 / 3分 / 5分 / 10分）
- **週の学習目標時間**（決めない / 3 / 5 / 7 / 10 / 14時間）— 決めるとホームに進捗が出る
- ログアウト

---

## 3. データモデル

Supabase / PostgreSQL。**全テーブル RLS 有効、`user_id = auth.uid()` に限定**。

| テーブル | 列 | 役割 |
|---|---|---|
| `profiles` | `id`(=auth.users.id), `display_name`, `why_text`, `daily_goal_sec`, `weekly_goal_sec`, `created_at`, `updated_at` | サインアップ時にトリガで自動生成。`daily_goal_sec` は「1日の独り言（声を出す）の目標」、`weekly_goal_sec` は「週の学習時間の目標」で別の軸（`migration 0009`）。**`weekly_goal_sec` の 0 は未設定**で、既定値を置かない（本人が決めていない数字に未達を出し続けないため） |
| `materials` | `id`, `user_id`, `youtube_video_id`, `title`, `channel_name`, `level`, `thumbnail_url`, `created_at` | 素材。`(user_id, youtube_video_id)` で一意 |
| `clips` | `id`, `user_id`, `material_id`, `label`, `start_sec`, `end_sec`, `transcript`, `translation_ja`, `annotations`(jsonb), `memo`, `source`, `source_text`, `created_at`, `updated_at` | 練習区間（ノート1ページ）。**2系統**：`source='youtube'` は `material_id`＋`start_sec/end_sec` を持つ動画クリップ、`source='text'` は `material_id`/`start_sec`/`end_sec` が **NULL**・`transcript` にユーザーの英文・`source_text` にAI推敲前の原文（未推敲なら NULL）を持つ自作テキスト（`migration 0007`） |
| `practice_logs` | `id`, `user_id`, `clip_id`, `rep_count`, `practiced_at` | リプロダクションの反復記録 |
| `monologue_topics` | `id`, `user_id`, `title_en`, `title_ja`, `category`, `sort_order`, `created_at` | `user_id` が NULL のものは共通シード30件 |
| `monologue_sessions` | `id`, `user_id`, `topic_id`, `mode`, `duration_sec`, `ja_memo`, `ai_suggestions`(jsonb), `used_phrase_ids`, `started_at` | 独り言1回分 |
| `recordings` | `id`, `user_id`, `kind`, `clip_id`, `monologue_session_id`, `storage_path`, `mime_type`, `duration_sec`, `created_at` | 音声本体は Storage、ここはメタデータ。**独り言は保存せず、リプロダクションの聴き比べ録音のみ** |
| `phrases` | `id`, `user_id`, `clip_id`, `text`, `meaning_ja`, `used_count`, `last_used_at`, `graduated_at`, `created_at` | **①と②を繋ぐ中核テーブル**。`graduated_at` が NULL の在庫だけが「今日使うフレーズ」に出る（初回使用で卒業） |
| `composition_courses` | `id`, `user_id`, `title`, `description`, `created_at`, `updated_at` | 瞬間英作文のコース（例文の束） |
| `compositions` | `id`, `user_id`, `course_id`, `ja`, `en`, `sort_order`, `starred`, `created_at`, `updated_at` | 例文1件（日本語＋英語）。`course_id` 内の `sort_order` 昇順が登録順。`course_id` は `on delete cascade`。`starred`（boolean・既定 false）は「★＝重点的に練習したい」印で、プレイヤーの「★のみ」対象に使う（`migration 0006`） |
| `composition_logs` | `id`, `user_id`, `course_id`, `rep_count`, `practiced_at` | 読み上げ回数の記録（`practice_logs` と同型）。`course_id` は **`on delete set null`**（コースを消しても連続日数の履歴は巻き戻さない） |
| `study_sessions` | `id`, `user_id`, `kind`, `started_at`, `ended_at`, `duration_sec`, `auto_closed`, `adjusted_at`, `created_at` | 学習時間の計測1回分（`migration 0008`）。`ended_at` が NULL なら計測中で、**`(user_id) where ended_at is null` の部分ユニーク索引で同時1本に限定**。`duration_sec` は `started_at`/`ended_at` からの**生成列**（書き込めない。直すときは時刻のほうを動かす＝矛盾した行を作れない）。`auto_closed` は押し忘れをアプリが 0分 で締めた印 |
| `daily_activity`（ビュー） | `user_id`, `activity_date`, `reproduction_reps`, `monologue_sec`, `recording_sec`, `composition_reps`, `study_sec` | 継続トラッキング用。`security_invoker = on` で RLS を継承。**`study_sec` と `monologue_sec` は重なる**（独り言も学習時間の計測に乗る）ので、表示でも集計でも足し合わせない |

`monologue_topics` だけ SELECT ポリシーが `user_id is null or auth.uid() = user_id`（共通シードを全員が読む）。

**`migration 0007`（自作テキストのリプロダクション）** — 新テーブルを増やさず `clips` を拡張する。`material_id`・`start_sec`・`end_sec` を **nullable** にし、`source text not null default 'youtube'`（`check (source in ('youtube','text'))`）と `source_text text` を足す。既存の `end_sec > 0` / `end_sec > start_sec` の制約は source 条件つきに置き換える：`check (source <> 'youtube' or (material_id is not null and start_sec is not null and end_sec is not null and start_sec >= 0 and end_sec > start_sec))`、および `check (source <> 'text' or material_id is null)`（テキストは動画を参照しない）。既存行は `source='youtube'` になり互換。RLS（`clips_all_own`）・関連する FK（`practice_logs`・`recordings`・`phrases` の `clip_id`）はそのまま両系統に効く。`Clip` 型は `material_id`/`start_sec`/`end_sec` が `string|null`/`number|null`、`source: 'youtube'|'text'`、`source_text: string|null` になり、ワークスペースの `material` prop は `source='text'` で無し。

**Storage** — `recordings` バケット（非公開）。パスは `<user_id>/<kind>/<uuid>.<ext>`。
`storage.foldername(name)[1] = auth.uid()` のポリシーで他人のフォルダに触れない。
リプロダクションの録音（聴き比べ用）だけをクライアントから直接アップロードし、Server Action はメタデータ行だけ作る（Blob をサーバに通さない）。**独り言の録音は保存しない**（時間だけ `monologue_sessions.duration_sec` に残す）。

`tts` バケット（**公開**）— 瞬間英作文の読み上げ音声（MP3）のキャッシュ。パスは content-hash（`sha256(model|voice|text).mp3`）で、機微でない英語音声なので公開読み（`<audio src>` に public URL を使う）。`POST /api/tts` が生成し、**サーバ専用の service role キーで保存する**（`SUPABASE_SERVICE_ROLE_KEY`）。SSR サーバクライアントの storage はユーザー JWT を確実に載せられず（`/api` は proxy のセッション更新対象外）、insert の RLS を通せないため。RLS は `recordings` と同じく `auth.uid()` 判定（storage では `to authenticated` が効かない）。`migration 0005`。

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
| `POST /api/ai/naturalize` | `text`, `note?`(言いたいこと) | `naturalized`, `note_ja`(どう自然にしたか・1〜2文) | `medium` | 4000 |
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

`naturalize` は自作テキストを"完成された英語"に寄せるための任意ステップ。**意味を保ったまま**ネイティブが自然に言う英語へ書き換える（大意を変えない・過剰な言い換えをしない）方針で、`note_ja` に主な直し（冠詞・時制・自然な語順など）を1〜2文で添える。学習者英語を100に近づけて再現原則を守るためのもので、外部のネイティブ文章にはそもそも不要。採用は任意で、採用しなければ原文をそのまま再現する。他のエンドポイントと同じく `runStructured()` 経由・refusal 分岐あり。

**音声認識は入れていない。** Claude API に音声入力はなく、Web Speech API は Chrome 限定で精度も不安定。
元動画自身が「録音は聞き返すためではなく可視化のため」と言っているので、日本語メモ → AI 変換のほうが忠実で確実だと判断した。
将来 Whisper を足す余地は `recordings` テーブルに残してある。

なお、瞬間英作文の**音声読み上げは別系統**（TTS＝音声合成で、認識=STT とは無関係）。当初はブラウザ標準の `speechSynthesis` を使っていたが、使ううちに固まって無音化する（要ブラウザ再起動）ため、**クラウドTTS**に切り替えた：`POST /api/tts`（`runStructured` は経由せず OpenAI TTS を直叩き）が MP3 を生成して公開バケット `tts` にキャッシュし、クライアントは `<audio>` で再生する（`src/lib/speaker.ts`）。`OPENAI_API_KEY` 未設定時は `speechSynthesis` フォールバックで動く。

---

## 5. Server Actions

DB 書き込みは Server Action 経由（`src/app/actions/`）。

| ファイル | 関数 |
|---|---|
| `materials.ts` | `createMaterial`, `deleteMaterial` |
| `clips.ts` | `createClip`, `createTextClip`(source='text'), `updateClip`(`source_text` も受ける), `deleteClip`, `logPractice` |
| `phrases.ts` | `addPhrases`, `markPhraseUsed`, `deletePhrase` |
| `monologue.ts` | `saveMonologueSession`, `saveMonologueFeedback`, `addCustomTopic` |
| `compositions.ts` | `createCourse`, `updateCourse`, `deleteCourse`, `addComposition`, `updateComposition`, `deleteComposition`, `importCompositions`, `logCompositionReps` |
| `recordings.ts` | `saveRecording` |
| `study.ts` | `startStudySession`, `stopStudySession`, `adjustStudySession`, `deleteStudySession` |
| `profile.ts` | `updateProfile`, `signOut` |

戻り値は `ActionResult<T>`（`src/lib/action-result.ts`）。`'use server'` なファイルは async 関数しか export できないので型は別モジュールに置いてある。

**読み取りは Server Action に置かない**。`'use server'` の export はすべて公開エンドポイントになるため、サーバコンポーネント専用の読み取り（`getRunningStudySession` / `getRecentStudySessions`）は `src/lib/study-server.ts` に置く。

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
| サーバー側の文字起こし自動取得は不安定（IPブロック・CORS） | 取得はユーザーのブラウザで動くブックマークレット。手動コピペもフォールバックに残す |
| `font-mono`（Geist Mono）に日本語グリフがない | 「3回」「1日」「30秒」の単位は `font-mono` の外に出す。中に入れると豆腐になる |
| 選択範囲はボタンの mousedown で解除される | 注釈ツールバーは `onMouseDown` で `preventDefault()` する |
| 音声読み上げ（TTS）はブラウザ差が大きい | `speechSynthesis`。声は非同期ロード（`onvoiceschanged` を待つ）。iOS Safari は発話にユーザー操作の連鎖が要る（スタート時に無音発話で解錠）。非対応環境は固定秒送りにフォールバック |
| `speechSynthesis` は使ううちにエンジンが固まる（無音化） | 固まると voice はあるのに `start` が来ず、**リロードでは戻らずブラウザ再起動が要る**（音声サービス側の固着）。→ 読み上げの主経路を**クラウドTTS＋`<audio>`再生**に変更し、`speechSynthesis` は未設定/失敗時のフォールバックへ降格（固着ゼロ）。フォールバック用に発話中は `resume()` の keepalive（8秒毎）だけ残す |
| Route Handler から Storage に書けない（RLS 403） | ①`storage.upload()` に `ArrayBuffer` を渡すと壊れる→Storage REST に生バイトで送る ②storage の RLS は `to authenticated` が効かない→`auth.uid()` で判定 ③SSR サーバクライアントはユーザー JWT を storage に載せられず（`/api` は proxy 対象外で失効も絡む）認証済みでも 403→**サーバ専用の service role キーで保存**（認証は `getUser` で担保） |
| CSV の文にカンマ・引用符が混じる | 例文がカンマを含む前提で RFC4180 パースし、タブ区切りも受ける。自前パーサをユニットテスト対象にする |
| TTS の入力は `MAX_LEN=500` 文字まで（`/api/tts`） | 自作テキストは `splitSentences()` で**文単位に分割してから1文ずつ生成**する。1文は必ず 500 に収まる。全文を一度に投げない |
| 自作テキストの再生速度（0.5/0.75/1.0） | TTS を速度別に再生成せず、`<audio>.playbackRate` に `preservesPitch=true` を併用してクライアント側で変速する。キャッシュ（content-hash）を汚さず、0.5倍でもピッチが保たれる |
| 自作テキストには動画が無い | `clips.source` で左カラムを分岐し、`source='text'` では YouTube プレイヤーを出さない。`/clips/[id]` は material 無しでも 404 にしない（従来は material 必須だった） |

---

## 7. 検証状況

2026-08-01 時点（本番反映・クラウドTTS は 2026-08-20 に追記／自作テキストのリプロダクションは 2026-08-22 に**設計のみ**を追記）。ローカル Supabase（Docker）を立てて実際に通した結果と、本番（クラウド Supabase / Vercel）で確認した結果。

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
| **瞬間英作文のマイグレーション0004**（3テーブル・全RLS・FK・`daily_activity` へ `composition_reps` 追加） | ローカルへ適用を確認。`compositions` は course 削除で cascade、`composition_logs.course_id` は set null |
| **瞬間英作文のビュー集計**（`composition_logs` → `daily_activity.composition_reps`、JST 日付境界） | 実データ1件で 7 回が集計されること、コース削除後も log が `course_id=null` で残る（連続日数を巻き戻さない）ことを確認 |
| **瞬間英作文のプレイヤー**（Playwright・ログイン状態） | 残り時間ゲージの表示、中断→「続きから」で保存位置から再開、1文=1回の都度記録（DB に `rep_count:1` が +N 行）、一覧の行の読み上げ発火、答え読み上げ後の**再現の間（約3秒）で次へ送る**ことを確認 |
| **例文の★と「★のみ」で流す**（`migration 0006`・Playwright/ログイン状態） | ローカルに 0006 適用（`compositions.starred` = boolean NOT NULL default false）。一覧の★トグルが `compositions.starred` に永続、ヘッダの★件数表示と「★のみ」の有効/無効化（0件なら不可）を確認。「★のみ」で開始すると★付きだけが流れる（2件→「2文」で1周完了）ことを確認。**ドリル中の★タップは答え表示も次への送りもせずトグルのみ**（考える時間中に押しても `1/2`・`完了 0`・「考える時間」のまま）で、DB へ永続することを確認。**本番（クラウド Supabase）へは未適用** |
| **瞬間英作文の本番反映**（0004/0005 をクラウド Supabase に適用） | CI のマイグレーション→デプロイ順で適用済み。本番でプレイヤーとクラウドTTSが動作することを確認 |
| **クラウドTTSの本番動作**（`POST /api/tts`→`tts` バケット→`<audio>` 再生） | ローカルで生成200（約2.6秒）・2回目 `cached:true` 68ms・public URL の音声 HEAD 200。**本番でも生成・保存・再生を確認**（本番 Storage は新形式 `sb_secret_` ではなく legacy `service_role` JWT が要ると判明して解決） |
| **自作テキストの `migration 0007`**（`clips` に `source`/`source_text` 追加・`material_id`/`start_sec`/`end_sec` を nullable 化・source 別 CHECK） | ローカルへ適用を確認。既存クリップは `source='youtube'` にバックフィル、text クリップ（range NULL）は insert 成功、`source='text'` に material_id を付けると `clips_text_shape` 違反、`source='youtube'` に range NULL だと `clips_youtube_shape` 違反になることを確認。既存の `end_sec > 0` 等は NULL を素通しするので drop 不要 |
| **学習時間の `migration 0008`**（`study_sessions` ＋ RLS ＋ 部分ユニーク索引 ＋ `daily_activity` へ `study_sec` 追加） | ローカルへ適用を確認。計測中2本目の insert が `study_sessions_one_running_idx` で弾かれる、生成列 `duration_sec` の update が拒否される、`daily_activity.study_sec` に 35分が JST 日付で集計されることを確認。**RLS の分離**は別ユーザーで 0件・他人の `user_id` での insert が policy 違反になることを確認（アプリ上でも、別ユーザーの計測中セッションがバーに出ないことを確認） |
| **学習時間の通しUI**（Playwright・ログイン状態） | 独り言で開始 → 計測中バーが出て時計が進む → **別ページへ全ページ遷移しても計測が続く**（00:12 → 00:19）→ コース画面で「切り替えて開始」で瞬間英作文へ切り替わり前の1本が閉じる → バーの終了で記録、を確認。ダッシュボードの明細で 0分 の行を「19:30・35分」に直すと `19:30–20:05 / 35分`・当日合計 35分 になることを確認。**押し忘れ**（8時間経過の計測中）はバーが「6時間を超えています」に変わり、終了すると 0分＋「終了し忘れ」バッジ＋件数バナーになることを確認。スマホ幅（390px）で計測中バーが下部ナビの直上に載ることを確認 |
| **週の学習目標の `migration 0009`**（`profiles.weekly_goal_sec`） | ローカルへ適用を確認（`not null default 0` ＋ `>= 0` の CHECK）。既存行は 0＝未設定にバックフィル |
| **週の学習目標の通しUI**（Playwright・ログイン状態） | 設定で「7時間」を選んで保存 → ホームに `4時間34分 / 7時間・65%`・残りとあと何日・曜日ごとの棒グラフが出ることを確認。**未設定（0）**では学習時間だけ出して「目標を決める」へ誘導、**達成時**は緑のバー・153%・「超過ぶん 1時間34分」になることを確認。曜日の棒は7列すべて同じ高さ・同じ上端に揃うことを DOM の実測で確認（0分の日でラベルが潰れて列がずれるのを修正済み）。スマホ幅（390px）でも崩れないことを確認 |
| ビルド / Lint / ユニットテスト66件 | 全通過（`next build` で `/api/ai/naturalize` 含む全ルート生成、`tsc --noEmit`・eslint クリーン） |

### 未検証

| 対象 | 理由 |
|---|---|
| **学習時間・週の目標の本番反映**（`migration 0008` / `0009` のクラウド Supabase 適用） | ローカルには適用・検証済みだが本番へは未適用（CI のマイグレーション→デプロイ順で流す） |
| **週の目標のペース目盛り**（進捗バー上の縦線） | 検証日が日曜（週の最終日＝ペース100%）で、目盛りを出す条件（`0 < ペース% < 100`）に入らなかったため画面では未確認。`paceSec` の値はユニットテスト済み |
| **自作テキストのリプロダクションの通しUI**（テキスト登録→任意でAI推敲→文単位で再現→回数記録／聴き比べ／マーキング） | 実装済み。**ブラウザ通し（Playwright）は未実施**。実機の `<audio>` 解錠・TTS 再生・「言えた」で `practice_logs` 加算・reanchor（推敲差し替え時）を通しで確認する必要がある |
| **自作テキストの本番反映**（`migration 0007` のクラウド Supabase 適用） | ローカルには適用・検証済みだが本番へは未適用（CI のマイグレーション→デプロイ順で流す）。`/api/ai/naturalize` は `ANTHROPIC_API_KEY`、TTS は `OPENAI_API_KEY` 前提 |
| **例文の★の本番反映**（`migration 0006` のクラウド Supabase 適用） | ローカルでは適用・動作確認済みだが、本番へは未適用（0006 を CI のマイグレーション→デプロイ順で流す必要がある） |
| **AI エンドポイント4本** | `ANTHROPIC_API_KEY` 未設定のため実行していない。型・スキーマ・refusal 分岐はコード上は確認済み。`annotate` は quote 照合方式に変え、整数オフセット誤差は原理的に回避したが、**AI が quote を逐語一致でコピーできるかは実行して確かめる必要がある** |
| **録音の実機保存**（Storage アップロード＋メタデータ行） | ヘッドレスブラウザにマイクがないため |
| 実機のモバイル（iOS / Android）での動作（特に iOS Safari の `<audio>` 実機解錠） | 未実施。ヘッドレス環境では実機の音声解錠を再現できない |

### テスト

`npm test` は `node:test` で `tests/*.test.ts` を実行する（66件）。
外部依存のないロジックだけを対象にしている。

- 文字起こしの整形（タイムスタンプ除去、文分割とオフセットの一致）
- 注釈の正規化（範囲外・空範囲・未知種別・重複IDの排除）
- 連続日数とヒートマップ（月・年またぎ、今日未着手の扱い、瞬間英作文だけの日、学習時間だけの日、独り言との二重カウント防止）
- 週の学習目標（月曜始まりの週の切り出しと月・年またぎ、進捗・残り日数・1日あたり・ペース、達成時の頭打ちと超過、目標未設定の扱い）
- 学習時間（経過秒の算出と時計の巻き戻し、`mm:ss`/`h:mm:ss` 表示、「1時間35分」表示、JST の日付・時刻の読み書き、あとから直すときの終了時刻の再計算と上限の丸め）
- YouTube URL の解釈（各種形式、不正入力）
- CSV／TSV の一括登録パース（クオート・カンマ・タブ・ヘッダー有無・改行/CRLF/BOM）
