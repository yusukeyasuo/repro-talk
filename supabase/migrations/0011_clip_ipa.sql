-- 発音記号（IPA）。単語ごとに、transcript の [start, end) と読みを持つ。
--
-- annotations（音の記号）と同じく **transcript の文字インデックス参照** にする。
-- 同じ単語が何度も出てくるので語をキーにはできず（homograph も取り違える）、
-- 位置で持てば「いま練習している1文」に重なる分だけを取り出せる。
--
-- annotations とは別の列にする。annotations は本人がカラーペン代わりに手で
-- 付け直すもの、ipa は辞書の読みで、消える条件も付け直す手間も違う。
-- 既定は空配列＝未生成（本人が「発音記号」を出したときに AI が作る）。

alter table public.clips
  add column ipa jsonb not null default '[]'::jsonb;
