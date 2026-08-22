-- 瞬間英作文の例文に「★（重点マーク）」を足す。
-- ★ = 「まだ言えない・重点的に練習したい」印。言えるようになったら外す。
-- プレイヤーの「★だけ」対象（もう言えるものは飛ばして絞る）に使う。
-- 既存の例文はすべて false 始まり。RLS・トリガは compositions の既存設定をそのまま継承する。

alter table public.compositions
  add column starred boolean not null default false;
