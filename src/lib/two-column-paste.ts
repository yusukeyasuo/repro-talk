/**
 * 「1行 = 2列」の貼り付けを読むパーサ。瞬間英作文の例文と独り言のお題で共有する。
 *
 * 例文はカンマ（"I see, that makes sense."）を含むので RFC4180 のクオート
 * （"..." と "" エスケープ）を解する。スプレッドシートからの貼り付けはタブ区切りに
 * なるので、タブがあれば TSV として扱う。
 * LLM の整数オフセットのような曖昧さはない領域なので、素直な1パスの状態機械で書く。
 */

/** [1列目, 2列目]。どちらが英語かは呼び出し側が決める。 */
export type TwoColumnRow = [string, string];

export type ParsedTwoColumns = {
  rows: TwoColumnRow[];
  /** 列が足りない等で落とした行数（空行はカウントしない） */
  skipped: number;
};

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

function looksLikeHeader(fields: string[], headerTokens: ReadonlySet<string>): boolean {
  const a = fields[0]?.trim().toLowerCase();
  const b = fields[1]?.trim().toLowerCase();
  return (!!a && headerTokens.has(a)) || (!!b && headerTokens.has(b));
}

/**
 * 2列の貼り付けを行の配列にする。
 * 先頭行が headerTokens のどれかに当たれば見出し行として落とす。
 * 3列目以降は無視する（スプレッドシートの余計な列を貼っても通る）。
 */
export function parseTwoColumns(
  input: string,
  headerTokens: ReadonlySet<string>,
): ParsedTwoColumns {
  const text = input.replace(/^﻿/, ''); // 先頭 BOM を除去
  if (!text.trim()) return { rows: [], skipped: 0 };

  const raw = parseDelimited(text, detectDelimiter(text));

  const rows: TwoColumnRow[] = [];
  let skipped = 0;

  raw.forEach((fields, index) => {
    // 完全に空の行は無視（skipped に数えない）
    if (fields.every((f) => f.trim() === '')) return;
    // 先頭が見出しっぽければ落とす
    if (index === 0 && looksLikeHeader(fields, headerTokens)) return;

    const first = (fields[0] ?? '').trim();
    const second = (fields[1] ?? '').trim();
    if (!first || !second) {
      skipped += 1;
      return;
    }
    rows.push([first, second]);
  });

  return { rows, skipped };
}
