-- 自作テキストのリプロダクション。clips を2系統化する。
--   source='youtube' … 従来どおり material_id ＋ start_sec/end_sec を持つ動画クリップ
--   source='text'    … 動画を持たず、transcript にユーザーの英文、source_text に
--                       AI推敲前の原文（未推敲なら NULL）を持つ自作テキスト
-- 新テーブルは作らず既存 clips を拡張する。RLS（clips_all_own）・FK
-- （practice_logs / recordings / phrases の clip_id）・注釈/フレーズ抽出は
-- そのまま両系統に効く。

alter table public.clips
  add column source      text not null default 'youtube',
  add column source_text text;

-- text クリップは動画区間を持たないので nullable にする。
alter table public.clips
  alter column material_id drop not null,
  alter column start_sec   drop not null,
  alter column end_sec     drop not null;

-- 既存の start_sec >= 0 / end_sec > 0 / end_sec > start_sec は残す。
-- CHECK は NULL に対して「違反しない」ので、非NULL の youtube 行にだけ効き、
-- NULL の text 行は素通しする（＝ドロップ不要）。
-- source ごとの形だけ追加で担保する。
alter table public.clips
  add constraint clips_source_check check (source in ('youtube', 'text')),
  add constraint clips_youtube_shape check (
    source <> 'youtube'
    or (material_id is not null and start_sec is not null and end_sec is not null)
  ),
  add constraint clips_text_shape check (
    source <> 'text' or material_id is null
  );
