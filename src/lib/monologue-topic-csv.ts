/**
 * 独り言のお題の一括登録パーサ。1行 = 「英語,日本語」。
 * 並びが英作文（日本語,英語）と逆なのは、お題の画面が英語を主として出しているため。
 * 区切り・クオート・見出し行の扱いは `two-column-paste.ts` と共通。
 */

import { parseTwoColumns } from './two-column-paste.ts';

export type MonologueTopicDraft = { titleEn: string; titleJa: string };

export type ParsedMonologueTopics = {
  rows: MonologueTopicDraft[];
  /** 列が足りない等で落とした行数（空行はカウントしない） */
  skipped: number;
};

// 先頭行がこれらだけなら見出し行とみなして落とす
const HEADER_TOKENS = new Set([
  'ja',
  'en',
  'japanese',
  'english',
  'topic',
  'title',
  'title_en',
  'title_ja',
  '日本語',
  '英語',
  '英文',
  '和文',
  '意味',
  'お題',
  'テーマ',
]);

export function parseMonologueTopicsCsv(input: string): ParsedMonologueTopics {
  const { rows, skipped } = parseTwoColumns(input, HEADER_TOKENS);
  return { rows: rows.map(([titleEn, titleJa]) => ({ titleEn, titleJa })), skipped };
}
