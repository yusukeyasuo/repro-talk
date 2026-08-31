<!-- migration-guard -->
⚠️ **このPRはスマホで完結させないでください。**

`supabase/migrations/` に変更が入っています。プレビュー環境は本番 Supabase を共有していて、
マイグレーションは main への push 後にしか本番DBへ当たりません。つまり

- プレビューを開いても新しいスキーマが無く、**動かないか、誤った結果を見ることになります**
- 破壊的な変更（列の削除・リネーム・NOT NULL 化）は、main に入った瞬間に本番へ効きます

Mac に戻ってローカル Supabase で確認してからマージしてください。
背景は `docs/mobile-dev-workflow.md`。
