/**
 * 瞬間英作文の一括登録パーサ。1行 = 「日本語,英語」。
 * 区切り・クオート・見出し行の扱いは `two-column-paste.ts` と共通。
 */

// tests/ は node で直接実行するので、ここも拡張子付きで参照する（tsconfig の allowImportingTsExtensions）
import { parseTwoColumns } from './two-column-paste.ts';

export type CompositionDraft = { ja: string; en: string };

export type ParsedCompositions = {
  rows: CompositionDraft[];
  /** 列が足りない等で落とした行数（空行はカウントしない） */
  skipped: number;
};

// 先頭行がこれらだけなら見出し行とみなして落とす
const HEADER_TOKENS = new Set([
  'ja',
  'en',
  'japanese',
  'english',
  '日本語',
  '英語',
  '英文',
  '和文',
  '意味',
]);

export function parseCompositionsCsv(input: string): ParsedCompositions {
  const { rows, skipped } = parseTwoColumns(input, HEADER_TOKENS);
  return { rows: rows.map(([ja, en]) => ({ ja, en })), skipped };
}
