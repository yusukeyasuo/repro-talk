-- 瞬間英作文の「応用練習」。コース内の表現を2〜3個組み合わせ、主語や目的語を変えた
-- 日本語を AI に作らせ、それを英作文する練習。
--
-- 生成した文は**新テーブルを作らず compositions にそのまま入れる**。★・読み上げ・
-- 回数記録（composition_logs）・中断と再開・編集・削除がすべて既存のまま効くため。
-- 代わりに出自を1列で持ち、プレイヤーの「対象」で 基本のみ / 応用のみ に絞れるようにする。
--   source='manual' … 本人が入れた例文（従来の全行。default でそのまま埋まる）
--   source='ai'     … 応用練習で AI が作り、本人が採用した文
--
-- 「本人が採用した文だけ入る」ことが前提。AI の出力を無検品で入れる導線は作らない
-- （誤った答えを読み上げると学習者を害する。発音の自動採点をしないのと同じ理由）。

alter table public.compositions
  add column source text not null default 'manual';

alter table public.compositions
  add constraint compositions_source_check check (source in ('manual', 'ai'));
