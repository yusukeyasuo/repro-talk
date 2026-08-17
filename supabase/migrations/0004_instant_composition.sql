-- 瞬間英作文（判断: 元動画の「2つ」に含まれない4本目の導線）
-- 日本語を見た瞬間に英語を口から出すドリル。コース（例文の束）を作り、
-- 選んで流すと 日本語→答え表示＋読み上げ→次… と自動で進む。
-- 全テーブル RLS で user_id = auth.uid() に限定する（既存テーブルと同じ）。

-- ---------------------------------------------------------------------------
-- composition_courses — 瞬間英作文のコース（例文の束）
-- ---------------------------------------------------------------------------
create table public.composition_courses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.composition_courses enable row level security;

create policy "composition_courses_all_own" on public.composition_courses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index composition_courses_user_idx on public.composition_courses (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- compositions — 例文1件（日本語＋英語）。course_id 内の sort_order 昇順が登録順。
-- ---------------------------------------------------------------------------
create table public.compositions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  course_id  uuid not null references public.composition_courses (id) on delete cascade,
  ja         text not null,
  en         text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.compositions enable row level security;

create policy "compositions_all_own" on public.compositions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 「登録順」に流すための索引（course 内で sort_order → created_at）
create index compositions_course_idx on public.compositions (course_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- composition_logs — 読み上げ回数の記録（practice_logs と同型）。
-- course_id は on delete set null。コースを消しても連続日数の履歴は巻き戻さない
-- （継続の可視化が主目的なので、練習した事実は course より寿命が長い）。
-- ---------------------------------------------------------------------------
create table public.composition_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  course_id    uuid references public.composition_courses (id) on delete set null,
  rep_count    integer not null default 1 check (rep_count > 0),
  practiced_at timestamptz not null default now()
);

alter table public.composition_logs enable row level security;

create policy "composition_logs_all_own" on public.composition_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index composition_logs_user_time_idx on public.composition_logs (user_id, practiced_at desc);

-- ---------------------------------------------------------------------------
-- updated_at の自動更新（既存の touch_updated_at を流用）
-- ---------------------------------------------------------------------------
create trigger composition_courses_touch_updated_at
  before update on public.composition_courses
  for each row execute function public.touch_updated_at();

create trigger compositions_touch_updated_at
  before update on public.compositions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- daily_activity — composition_reps を足して作り直す。
-- 新しい列は末尾に追加するだけなので create or replace view が通る。
-- 瞬間英作文だけをやった日も「動かした日」に含まれる（連続日数・ヒートマップ）。
-- ---------------------------------------------------------------------------
create or replace view public.daily_activity
with (security_invoker = on) as
select
  user_id,
  activity_date,
  sum(reproduction_reps)::integer as reproduction_reps,
  sum(monologue_sec)::integer     as monologue_sec,
  sum(recording_sec)::integer     as recording_sec,
  sum(composition_reps)::integer  as composition_reps
from (
  select user_id,
         (practiced_at at time zone 'Asia/Tokyo')::date as activity_date,
         rep_count as reproduction_reps, 0 as monologue_sec, 0 as recording_sec, 0 as composition_reps
  from public.practice_logs
  union all
  select user_id,
         (started_at at time zone 'Asia/Tokyo')::date,
         0, duration_sec, 0, 0
  from public.monologue_sessions
  union all
  select user_id,
         (created_at at time zone 'Asia/Tokyo')::date,
         0, 0, duration_sec, 0
  from public.recordings
  union all
  select user_id,
         (practiced_at at time zone 'Asia/Tokyo')::date,
         0, 0, 0, rep_count
  from public.composition_logs
) t
group by user_id, activity_date;
