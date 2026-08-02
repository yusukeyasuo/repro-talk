-- repro-talk 初期スキーマ
-- リプロダクション（100を100のまま受け取る）と独り言（0から1を生み出す）を
-- 1人で回すためのテーブル群。全テーブル RLS で user_id = auth.uid() に限定する。

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  -- 「英語の先に理解したい何か」。継続の本質なのでダッシュボードに常時出す。
  why_text      text,
  daily_goal_sec integer not null default 60,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- サインアップ時に profiles を自動作成する
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- materials — リプロダクションの素材（YouTube 動画）
-- ---------------------------------------------------------------------------
create table public.materials (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  youtube_video_id text not null,
  title            text not null,
  channel_name     text,
  -- 1: 和訳付きフレーズ動画 / 2: 英語学習者向け英語チャンネル
  -- 3: 興味分野の海外チャンネル / 4: 海外ドラマ・映画
  level            smallint not null default 1 check (level between 1 and 4),
  thumbnail_url    text,
  created_at       timestamptz not null default now(),
  unique (user_id, youtube_video_id)
);

alter table public.materials enable row level security;

create policy "materials_all_own" on public.materials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index materials_user_level_idx on public.materials (user_id, level, created_at desc);

-- ---------------------------------------------------------------------------
-- clips — 30秒前後の練習区間。紙のノート1ページに相当する。
-- ---------------------------------------------------------------------------
create table public.clips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  material_id    uuid not null references public.materials (id) on delete cascade,
  label          text,
  start_sec      numeric(10, 2) not null default 0 check (start_sec >= 0),
  end_sec        numeric(10, 2) not null check (end_sec > 0),
  -- 原文。annotations はこの文字列の文字インデックスを参照する（= 正）。
  transcript     text not null default '',
  translation_ja text,
  -- Annotation[]（src/types/annotation.ts）
  annotations    jsonb not null default '[]'::jsonb,
  -- AI への質問と回答の蓄積（Markdown）
  memo           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_sec > start_sec)
);

alter table public.clips enable row level security;

create policy "clips_all_own" on public.clips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index clips_material_idx on public.clips (material_id, start_sec);
create index clips_user_idx on public.clips (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- practice_logs — リプロダクションの反復記録
-- ---------------------------------------------------------------------------
create table public.practice_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  clip_id     uuid not null references public.clips (id) on delete cascade,
  rep_count   integer not null default 1 check (rep_count > 0),
  practiced_at timestamptz not null default now()
);

alter table public.practice_logs enable row level security;

create policy "practice_logs_all_own" on public.practice_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index practice_logs_user_time_idx on public.practice_logs (user_id, practiced_at desc);
create index practice_logs_clip_idx on public.practice_logs (clip_id, practiced_at desc);

-- ---------------------------------------------------------------------------
-- monologue_topics — 独り言のお題。user_id が null のものは共通シード。
-- ---------------------------------------------------------------------------
create table public.monologue_topics (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  title_en   text not null,
  title_ja   text not null,
  category   text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.monologue_topics enable row level security;

-- 共通シード（user_id is null）と自分のお題を読める
create policy "monologue_topics_select" on public.monologue_topics
  for select using (user_id is null or auth.uid() = user_id);
create policy "monologue_topics_insert_own" on public.monologue_topics
  for insert with check (auth.uid() = user_id);
create policy "monologue_topics_update_own" on public.monologue_topics
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "monologue_topics_delete_own" on public.monologue_topics
  for delete using (auth.uid() = user_id);

create index monologue_topics_order_idx on public.monologue_topics (sort_order);

-- ---------------------------------------------------------------------------
-- monologue_sessions — 独り言1回分
-- ---------------------------------------------------------------------------
create table public.monologue_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  topic_id       uuid references public.monologue_topics (id) on delete set null,
  -- 'phone' = 1人電話モード / 'free' = 自由
  mode           text not null default 'phone' check (mode in ('phone', 'free')),
  duration_sec   integer not null default 0 check (duration_sec >= 0),
  -- 「言いたかったけど言えなかったこと」の日本語メモ
  ja_memo        text,
  -- AI が返した英語表現（{ text, meaning_ja, examples[] }[]）
  ai_suggestions jsonb,
  used_phrase_ids uuid[] not null default '{}',
  started_at     timestamptz not null default now()
);

alter table public.monologue_sessions enable row level security;

create policy "monologue_sessions_all_own" on public.monologue_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index monologue_sessions_user_time_idx on public.monologue_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- recordings — 録音。「やった事実の可視化」が主目的。
-- ---------------------------------------------------------------------------
create table public.recordings (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  kind                 text not null check (kind in ('reproduction', 'monologue')),
  clip_id              uuid references public.clips (id) on delete cascade,
  monologue_session_id uuid references public.monologue_sessions (id) on delete cascade,
  storage_path         text not null,
  mime_type            text not null default 'audio/webm',
  duration_sec         integer not null default 0 check (duration_sec >= 0),
  created_at           timestamptz not null default now()
);

alter table public.recordings enable row level security;

create policy "recordings_all_own" on public.recordings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index recordings_user_time_idx on public.recordings (user_id, created_at desc);
create index recordings_clip_idx on public.recordings (clip_id, created_at desc);

-- ---------------------------------------------------------------------------
-- phrases — リプロダクションで得た表現の在庫。独り言で消費して 0 と 100 を繋ぐ。
-- ---------------------------------------------------------------------------
create table public.phrases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  clip_id      uuid references public.clips (id) on delete set null,
  text         text not null,
  meaning_ja   text,
  used_count   integer not null default 0 check (used_count >= 0),
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.phrases enable row level security;

create policy "phrases_all_own" on public.phrases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 「今日使うフレーズ」は未使用・最終使用が古い順に引く
create index phrases_pick_idx on public.phrases (user_id, used_count, last_used_at nulls first);

-- ---------------------------------------------------------------------------
-- daily_activity — 継続トラッキング用ビュー（ヒートマップ・連続日数）
-- 日付境界は Asia/Tokyo 固定。1人用ツールなので当面これで足りる。
-- ---------------------------------------------------------------------------
create or replace view public.daily_activity
with (security_invoker = on) as
select
  user_id,
  activity_date,
  sum(reproduction_reps)::integer as reproduction_reps,
  sum(monologue_sec)::integer     as monologue_sec,
  sum(recording_sec)::integer     as recording_sec
from (
  select user_id,
         (practiced_at at time zone 'Asia/Tokyo')::date as activity_date,
         rep_count as reproduction_reps, 0 as monologue_sec, 0 as recording_sec
  from public.practice_logs
  union all
  select user_id,
         (started_at at time zone 'Asia/Tokyo')::date,
         0, duration_sec, 0
  from public.monologue_sessions
  union all
  select user_id,
         (created_at at time zone 'Asia/Tokyo')::date,
         0, 0, duration_sec
  from public.recordings
) t
group by user_id, activity_date;

-- ---------------------------------------------------------------------------
-- Storage — 録音の保管先。パスは <user_id>/<kind>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy "recordings_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "recordings_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "recordings_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- updated_at の自動更新
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clips_touch_updated_at
  before update on public.clips
  for each row execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
