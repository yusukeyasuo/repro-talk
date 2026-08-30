-- 学習時間の計測。開始ボタンで1行作り、終了ボタンで ended_at を入れる。
--
-- 既存の記録は「何回やったか」（practice_logs / composition_logs）と
-- 「どれだけ話したか」（monologue_sessions.duration_sec）で、
-- 「机に向かっていた時間」は誰も持っていなかった。それをここで持つ。
--
-- 独り言も含めた3種すべてがこのテーブルに乗る。独り言の duration_sec は
-- 「実際に声を出していた時間」で、こちらは「学習していた時間」。
-- 別物なので両方残し、集計では決して足し合わせない（daily_activity の列も分ける）。

create table public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('reproduction', 'monologue', 'composition')),
  started_at timestamptz not null default now(),
  -- NULL = 計測中。1ユーザーにつき同時に1本だけ（下の部分ユニーク索引で担保）。
  ended_at   timestamptz,
  -- 常に started_at / ended_at から導出する。あとから直すときは時刻のほうを動かす
  -- （時間だけ別に持つと「開始19:00・終了19:30・45分」のような矛盾が作れてしまう）。
  duration_sec integer generated always as (
    case
      when ended_at is null then 0
      else greatest(0, floor(extract(epoch from (ended_at - started_at)))::integer)
    end
  ) stored,
  -- 終了ボタンの押し忘れを、次の開始時にアプリが締めた行。
  -- 本当の時間は分からないので 0 で締め（作り話をしない）、この印を頼りに本人が直す。
  auto_closed  boolean not null default false,
  -- 本人が時刻を直した時刻。直した行には「終了し忘れ」の警告を出さない。
  adjusted_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

alter table public.study_sessions enable row level security;

create policy "study_sessions_all_own" on public.study_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 計測中は1本だけ。別の学習を開始したら、前の1本を必ず閉じてから入れる
-- （アプリ側の startStudySession がそれをやる。ここは最後の防波堤）。
create unique index study_sessions_one_running_idx
  on public.study_sessions (user_id)
  where ended_at is null;

create index study_sessions_user_time_idx
  on public.study_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- daily_activity — study_sec を足して作り直す。
-- 新しい列は末尾に追加するだけなので create or replace view が通る。
-- 日をまたいだセッションは「開始日」に丸ごと計上する（monologue_sessions と同じ扱い）。
-- ---------------------------------------------------------------------------
create or replace view public.daily_activity
with (security_invoker = on) as
select
  user_id,
  activity_date,
  sum(reproduction_reps)::integer as reproduction_reps,
  sum(monologue_sec)::integer     as monologue_sec,
  sum(recording_sec)::integer     as recording_sec,
  sum(composition_reps)::integer  as composition_reps,
  sum(study_sec)::integer         as study_sec
from (
  select user_id,
         (practiced_at at time zone 'Asia/Tokyo')::date as activity_date,
         rep_count as reproduction_reps, 0 as monologue_sec, 0 as recording_sec,
         0 as composition_reps, 0 as study_sec
  from public.practice_logs
  union all
  select user_id,
         (started_at at time zone 'Asia/Tokyo')::date,
         0, duration_sec, 0, 0, 0
  from public.monologue_sessions
  union all
  select user_id,
         (created_at at time zone 'Asia/Tokyo')::date,
         0, 0, duration_sec, 0, 0
  from public.recordings
  union all
  select user_id,
         (practiced_at at time zone 'Asia/Tokyo')::date,
         0, 0, 0, rep_count, 0
  from public.composition_logs
  union all
  select user_id,
         (started_at at time zone 'Asia/Tokyo')::date,
         0, 0, 0, 0, duration_sec
  from public.study_sessions
) t
group by user_id, activity_date;
