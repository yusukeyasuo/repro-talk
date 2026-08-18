/**
 * 瞬間英作文の一括登録パーサ。
 * 1行 = 「日本語,英語」。例文はカンマ（"I see, that makes sense."）を含むので
 * RFC4180 のクオート（"..." と "" エスケープ）を解する。スプレッドシートからの
 * 貼り付けはタブ区切りになるので、タブがあれば TSV として扱う。
 * LLM の整数オフセットのような曖昧さはない領域なので、素直な1パスの状態機械で書く。
 */

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

/** スプレッドシート由来はタブ区切り。タブが混じっていれば TSV とみなす。 */
function detectDelimiter(text: string): ',' | '\t' {
  return text.includes('\t') ? '\t' : ',';
}

/** RFC4180 準拠の1パス・パーサ。引用符内の区切り・改行もそのまま通す。 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" は 1 個の " に
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1; // CRLF を1つの行区切りに
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // 改行で終わっていない末尾行を拾う
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

function looksLikeHeader(fields: string[]): boolean {
  const a = fields[0]?.trim().toLowerCase();
  const b = fields[1]?.trim().toLowerCase();
  return (!!a && HEADER_TOKENS.has(a)) || (!!b && HEADER_TOKENS.has(b));
}

export function parseCompositionsCsv(input: string): ParsedCompositions {
  const text = input.replace(/^﻿/, ''); // 先頭 BOM を除去
  if (!text.trim()) return { rows: [], skipped: 0 };

  const delimiter = detectDelimiter(text);
  const raw = parseDelimited(text, delimiter);

  const rows: CompositionDraft[] = [];
  let skipped = 0;

  raw.forEach((fields, index) => {
    // 完全に空の行は無視（skipped に数えない）
    if (fields.every((f) => f.trim() === '')) return;
    // 先頭が見出しっぽければ落とす
    if (index === 0 && looksLikeHeader(fields)) return;

    const ja = (fields[0] ?? '').trim();
    const en = (fields[1] ?? '').trim();
    if (!ja || !en) {
      skipped += 1;
      return;
    }
    rows.push({ ja, en });
  });

  return { rows, skipped };
}
