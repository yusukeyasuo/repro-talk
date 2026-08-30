-- 週の学習目標時間。
--
-- 既にある daily_goal_sec は「1日の独り言（＝声を出す）の目標」で、
-- こちらは「1週間の学習時間（study_sessions で計った机に向かった時間）の目標」。
-- 別の軸なので列を分ける。
--
-- 0 = 未設定。ホームでは目標セクションの代わりに設定への誘導を出す
--（daily_goal_sec と違って「とりあえずの既定値」を置くと、
--  本人が決めていない数字に対して未達が出続けてしまうため）。

alter table public.profiles
  add column weekly_goal_sec integer not null default 0 check (weekly_goal_sec >= 0);
