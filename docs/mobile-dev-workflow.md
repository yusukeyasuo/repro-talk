# スマホから開発を回すための構成

スマホでアプリを使っていて思いついた改善を、そのままスマホの中だけで
**修正 → commit/push → PR → マージ → 本番反映**まで運ぶための設計メモ。

調査・決定は 2026-08-30 時点。仕様は [`spec.md`](spec.md)、設計判断の背景は
[`../CLAUDE.md`](../CLAUDE.md) を参照。

---

## 1. 前提の整理：ボトルネックは git 操作ではない

「commit / PR / merge」の手順そのものは、すでに個人スキル
（`commit-push` / `create-pr` / `merge-cleanup`）で自動化されている。
エージェントを動かす場所さえ用意すれば、そこは解決する。

**本当に足りていないのは「スマホで安全にマージを決めるための根拠」。**
6インチの画面で差分を精読する前提の運用は必ず破綻するので、
判断の材料づくりを機械に肩代わりさせるのが、この構成の主眼になる。

### 着手前の実測（2026-08-30）

| 項目 | 状態 |
|---|---|
| PR に走る CI チェック | **なし**（`.github/workflows/` は本番デプロイ用の1本のみ） |
| main の branch protection / ruleset | **なし**（GitHub API で確認、`rulesets` は空配列） |
| main への push | 即 `supabase db push` → 本番 Vercel デプロイ（[`deploy-production.yml`](../.github/workflows/deploy-production.yml)） |
| PR ブランチのプレビューデプロイ | 有効（[`vercel.json`](../vercel.json) の無効化は `main` のみ） |
| Vercel env / Production | 5つ（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`） |
| Vercel env / **Preview** | **空**（`vercel env ls preview` で確認）→ 現状プレビューは動かない |
| `package.json` のスクリプト | `dev` / `build` / `start` / `lint` / `test`。**`typecheck` はない** |

つまり着手前の状態でスマホからマージすると、
**未検証のコードが本番DBのマイグレーションを引き連れて本番に出る。**

> `ANTHROPIC_API_KEY` は [`client.ts`](../src/lib/ai/client.ts) の `new Anthropic()` が
> 暗黙に読むため、コードを grep しても出てこない。数え漏らしやすい。

---

## 2. 推奨アーキテクチャ（3層に分ける）

### 層1：どこでエージェントを動かすか

| 方式 | 位置づけ | 備考 |
|---|---|---|
| **Claude Code on the web**（claude.ai/code・Claude アプリ） | ◎ 主軸 | GitHub 連携でクラウド sandbox が動き、ブランチを切って PR まで出す。Mac 不要・常時起動不要 |
| **GitHub Actions + Claude Code Action**（Issue で `@claude`） | ○ 併用 | 歩きながら Issue を立てて放置 → 戻ったら PR ができている。非同期の「思いつき投函」向け |
| **Tailscale + Mac へ ssh**（Blink / Termius） | △ 保険 | ローカル Supabase 込みの完全な環境が使える唯一の手段。ただし Mac を起こしておく必要があり、スマホでの入力・閲覧が苦痛 |

主軸は web、**思いつきの投函は GitHub Issue**、の二段構え。

「歩いていて浮かんだ」タイミングで腰を据えて対話するのは無理なので、
入口は **iOS ショートカット →`gh issue create`（音声入力可）で投げるだけ**にする。
セッションを開くかどうかは、あとで落ち着いてから決める。

### 層2：スマホで何を見て判断するか → プレビューURL

このアプリは**スマホで使う Web アプリ**なので、
差分を読むより**プレビュー環境を実機で触るほうが正しいレビューになる。**
PR ブランチのプレビューデプロイが生きていることが、この構成の最大の資産。

### 層3：マージの門番 → CIチェック + auto-merge

PR 用のワークフローで `tsc --noEmit` / `npm test` / `npm run lint` /
`npm run build` を回し、main に「このチェック必須」の ruleset をかける。

`gh pr merge --auto --squash` を使えば、
**スマホからは「auto-merge を有効化」するだけ**で、
グリーンになった瞬間に自分でマージされる。画面を見張る必要がなくなる。

---

## 3. 本番を汚さないために：案A（採用）

「本番に影響を与えないなら Preview 用の別DBが要るのでは」という問いに対する結論。
**"影響"を2つに分けると、必要なものが変わる。**

### ① 学習記録が汚れる → 別DBは不要

全テーブルの RLS が `auth.uid() = user_id` で効いていて
（[`0001_init.sql`](../supabase/migrations/0001_init.sql)）、Storage の `recordings` も
`(storage.foldername(name))[1] = auth.uid()::text` でユーザー単位に分離されている。

したがって **プレビュー専用のログインアカウント**を使えば、書き込みは全部その別ユーザーの
行に落ち、本人の学習記録は無傷。DBは共有のまま、追加コストゼロ。**これが案A。**

穴は3つあるが、いずれも学習記録は汚さない。

- `tts` バケットは**公開・共有キャッシュ**（[`0005_tts_cache.sql`](../supabase/migrations/0005_tts_cache.sql)）。
  content-hash 名なので同じ文は同じファイル。プレビューから書いても中身は同一音声。
- [`api/tts/route.ts`](../src/app/api/tts/route.ts) は **service role キーで直接アップロード**するので、
  この経路だけ RLS を迂回する。ただし書き込み先は上記の共有キャッシュのみ。
- `monologue_topics` の `user_id is null`（お題30件のシード）は全ユーザー共有。ただし
  insert/update/delete は `auth.uid() = user_id` 必須なのでプレビュー側から壊せない。

### ② スキーマ変更 → ここは別アカウントでは解決しない

DBが1つしかないので、マイグレーションを含む PR は詰む。

- **先に本番へ当てる** → 追加系（nullable列・新テーブル）なら本番コードは無視するので実害は
  小さいが、**破壊系（列の削除・リネーム・NOT NULL 化）は即座に本番が壊れる**
- **当てない** → プレビューが起動しない（列がない）

そこで **「migration を含む PR はスマホで完結させない」**を運用ルールにし、
[`pr-migration-guard.yml`](../.github/workflows/pr-migration-guard.yml) で機械に見張らせる。
PR に `migration` ラベルと警告コメントが自動で付く（**赤にはしない**。マージ自体は妨げない）。

### なぜ案Aから始めるか

| 案 | コスト | スキーマ変更PR |
|---|---|---|
| **A. プレビュー専用アカウント**＋ migration ガード | 0円・即日 | ✗ Macに戻る |
| B. Preview 用の別 Supabase プロジェクト | CI・env・Auth 設定の手間 | ✓ |
| C. Supabase Branching（PRごとに一時DB） | 有料プラン前提のはず（要確認） | ◎ |

①がゼロコストで解決する一方、②を解決する B/C は設定作業が重く、その前に層1・層2が
動いていないと投資が無駄になる。**まず A で回し、「Macに戻る回数」を実測してから**
B/C を検討する。マイグレーションの追加ペースは 2026-08-02〜08-30 で9本（約3日に1本）
なので、この頻度が続くなら早めに C の検討に入る。

---

## 4. 運用ルール（案A）

1. プレビューを触るときは**必ずプレビュー専用アカウントでログインする。**
   本番アカウントで入ると、テスト操作がそのまま自分の学習記録になる。
2. `migration` ラベルが付いた PR は**スマホでマージしない。** Mac に戻り、
   ローカル Supabase で確認してからマージする。
3. それ以外（UI・文言・ロジック）は、プレビューURLを実機で触って確認 → マージしてよい。

---

## 5. 残っている手作業（Vercel / Supabase 側）

コードで完結しない設定。**プレビューが動くにはこれが必須。**

### 5-1. Vercel の Preview スコープに env を5つ入れる

**（2026-08-30 完了。5つとも `Production, Preview` になっている）**

Production と同じ値でよい（案Aは本番DBを共有するため）。
**ダッシュボードで既存の変数を編集し、`Preview` にもチェックを入れるのが最短**
（値を手元に取り出さずに済む）。CLI でやるなら値の入力が要る。

対象：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`

> **`NEXT_PUBLIC_*` の2つは Secret 型のままだと保存できない。**
> Vercel が `Remove the public framework prefix to keep this value private.` を出して拒否する。
> `NEXT_PUBLIC_` 付きの値は Next.js がビルド時にブラウザのバンドルへ埋め込むため、
> Secret 型にしても実際には公開されているというのが Vercel の言い分で、これは正しい。
> [`client.ts`](../src/lib/supabase/client.ts) が `createBrowserClient` に渡しているとおり、
> この2つはすでにブラウザで動いている（`RLS + anon key` 構成の前提そのもの）。
> **Config（平文）型に変えてから Preview にチェックを入れる。**
> 値の再入力を求められたら Supabase 側が原本 —— URL は `https://<project-ref>.supabase.co`、
> キーは Project Settings → API の **anon / public**。
> **残り3つは Secret のまま。** 同じ操作で Config にすると service role キーが本当に漏れる。

> `SUPABASE_SERVICE_ROLE_KEY` を Preview に入れると、任意のブランチのプレビューが
> 本番DBの RLS を迂回できる鍵を持つ。サーバ側専用（`NEXT_PUBLIC_` ではない）なので
> ブラウザには漏れず、push できるのが本人だけである以上リスクは低いと判断した。
> 入れない選択も可能で、その場合 [`speaker.ts`](../src/lib/speaker.ts) が 503 を受けて
> `speechSynthesis` にフォールバックする（＝プレビューのTTSが本番と別物になる）。

### 5-2. Supabase の Auth redirect URL にプレビューを登録

ダッシュボード → Authentication → URL Configuration → **Redirect URLs** に1行足す。

```
https://repro-talk-*-yusukeyasuos-projects.vercel.app/**
```

プレビューURLは `repro-talk-git-<ブランチ>-…` と `repro-talk-<ハッシュ>-…` の2形式が出るが、
ホスト名の `*` はドットを跨がないのでこの1行で両方に当たり、かつ自分のチームの
このプロジェクトだけに限定される。**Site URL（`https://repro-talk.vercel.app`）は変えない。**

これが要るのは [`login/page.tsx`](../src/app/login/page.tsx) が
`emailRedirectTo: ${window.location.origin}/auth/callback` を渡しているため。
登録がないと Supabase がこの指定を拒否して Site URL（本番）へ飛ばすので、
「スマホでプレビューにログインしたら本番に着いた」という分かりにくい失敗になる。

> **`supabase config push` は実行しない。**
> [`config.toml`](../supabase/config.toml) の `site_url` はローカル用の `http://localhost:3000`。
> クラウドへ push すると本番の Auth 設定が localhost に上書きされ、本番ログインが全滅する。
> この設定はダッシュボードでのみ触る。

### 5-3. プレビュー専用アカウントを作る

`＋` 付きエイリアス（例 `y.yasuo+preview@…`）で、プレビューURL から Magic Link 登録する。

### 5-4. Deployment Protection の確認

Vercel は既定でプレビューに認証をかけることがある。有効だとスマホのブラウザで
Vercel にログインしないとプレビューを開けない。**スマホで開けるか一度試す。**

---

## 6. この構成が担保すること・しないこと

- **担保する**：スマホ単独での変更〜マージ。実機プレビューでの確認。学習記録を汚さないこと。
  スキーマ変更PRを見落とさないこと。
- **担保しない**：スキーマ変更を伴う修正のスマホ完結。差分の精読。マージ前の自動テスト
  （層3は未着手）。プレビューと本番のデータベース分離。
