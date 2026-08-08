-- ---------------------------------------------------------------------------
-- フレーズの卒業（判断2）
-- 「今日使うフレーズ」は①→②の受け渡しの中核。一度でも独り言で使えたら
-- その瞬間に「身についた」ものとして日々のプールから外す（初回使用で卒業）。
-- graduated_at が NULL のものだけが「今日使うフレーズ」に出る在庫。
-- ---------------------------------------------------------------------------
alter table public.phrases add column graduated_at timestamptz;

-- 既存データの移行：すでに1回以上使ったフレーズは卒業済みとみなす。
-- last_used_at があればその時刻、無ければ作成時刻を卒業時刻に充てる。
update public.phrases
set graduated_at = coalesce(last_used_at, created_at)
where used_count > 0;

-- 在庫（graduated_at is null）を新しい順に引くための索引。
create index phrases_pool_idx
  on public.phrases (user_id, created_at desc)
  where graduated_at is null;
