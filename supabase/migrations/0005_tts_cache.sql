-- 瞬間英作文のクラウドTTSキャッシュ。
-- ブラウザ標準の speechSynthesis は使ううちに固まる（無音化）ため、サーバで生成した
-- 音声(MP3)を content-hash 名で貯めて <audio> で再生する方式に切り替える。
-- 音声の中身は英語の例文の読み上げで機微情報ではないので、公開バケットにする
-- （<audio src> に public URL をそのまま使える）。

insert into storage.buckets (id, name, public)
values ('tts', 'tts', true)
on conflict (id) do nothing;

-- 認証ユーザーが生成結果を書き込める。読み取りは public URL 経由なので select policy は不要。
-- 同じ文は同じ hash 名になるため、実質的に共有キャッシュとして働く。
create policy "tts_storage_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tts');

-- 既存キャッシュを上書き（再生成）できるように update も認証ユーザーに許可。
create policy "tts_storage_update_authenticated" on storage.objects
  for update to authenticated
  using (bucket_id = 'tts')
  with check (bucket_id = 'tts');
