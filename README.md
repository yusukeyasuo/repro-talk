# repro-talk

「リプロダクション」と「独り言」の2つだけで英語を伸ばす学習法を、1人で回すためのWebアプリ。

- **リプロダクション** — ネイティブの英語を1文ずつ止めて完全に真似る。紙とペンで書き込んでいた音の記号（強勢・リンキング・脱落・フラップT・短縮・飲み込む音）を画面上で扱う。
- **独り言** — 自力で0から英語を作り出す。歩きながらの「1人電話」を録音して、やった事実を残す。
- **繋ぎ** — リプロダクションで抽出したフレーズが独り言の「今日使うフレーズ」に出てくる。使えたらチェック。

> このアプリが担保するのは習慣化と可視化であって、学習成果そのものではありません。元になった動画は個人の体験談です。

## セットアップ

### 1. 依存をインストール

```bash
npm install
```

### 2. Supabase を用意する

#### ローカルで動かす場合（推奨）

Docker Desktop を起動してから:

```bash
supabase start
```

`supabase/config.toml` はこのリポジトリに入っていて、以下を設定済み。

- `site_url` / `additional_redirect_urls` を `http://localhost:3000` に向けてある（Magic Link のリダイレクト先）
- `edge_runtime` は無効（このアプリでは使わないため）

起動時に `supabase/migrations/` が自動で流れ、独り言のお題30件も入る。
`supabase status` で出る **Project URL** と **Publishable key** を `.env.local` に入れる。
Magic Link のメールは実送信されず、Mailpit（http://127.0.0.1:54324）で確認する。

#### クラウドの Supabase を使う場合

[supabase.com](https://supabase.com) でプロジェクトを作り、SQL Editor で以下を順に実行する。

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_seed_monologue_topics.sql`

Supabase CLI があるなら、リンクしてから push でもよい。

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Authentication > Providers** で Email（Magic Link）を有効にし、**URL Configuration** の Redirect URLs に
`http://localhost:3000/auth/callback` を追加する。

### 3. 環境変数

`.env.example` を `.env.local` にコピーして埋める。

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
```

`ANTHROPIC_API_KEY` は [platform.claude.com](https://platform.claude.com/settings/keys) から取得する。

### 4. 起動

```bash
npm run dev
```

## 使い方

1. **素材を登録する** — `/materials` で YouTube の URL を貼り、レベル（L1〜L4）を選ぶ。
2. **30秒を切り出す** — 動画を再生しながら「ここから」「ここまで」を打つ。「かっこいい、こう喋りたい」と思う場所を選ぶ。
3. **スクリプトを入れる** — YouTube の「文字起こしを表示」からコピーして貼り、タイムスタンプを除去する。
4. **音を解析する** — 「AI で音を解析」で和訳と音の記号が付く。おかしいところは選択して手で直す。
5. **真似る** — 0.5倍速で聞き、1回再生して止め、同じように言う。録音して交互に聴き比べる。
6. **フレーズを渡す** — 「独り言で使えるフレーズを抽出」してストックへ。
7. **独り言をやる** — `/monologue` で1人電話。ストックしたフレーズを使えたらタップ。言えなかったことは日本語でメモして英語にしてもらう。

## テスト

外部依存のないロジック（文字起こしの整形、注釈の正規化、連続日数・ヒートマップ、YouTube URL の解釈）にテストがある。

```bash
npm test    # node:test で tests/*.test.ts を実行
npm run lint
npm run build
```

## デプロイ

Vercel にそのまま乗る。環境変数3つを設定し、Supabase の Redirect URLs に本番ドメインの `/auth/callback` を追加する。

## 開発メモ

設計上の制約と決定は `CLAUDE.md` にまとめてある。
