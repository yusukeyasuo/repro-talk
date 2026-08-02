import type { DailyActivity } from '@/types/database';

/** daily_activity ビューは Asia/Tokyo で日付を切っているので、こちらも揃える。 */
export function todayJst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

export function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function hasActivity(row: DailyActivity | undefined): boolean {
  if (!row) return false;
  return row.reproduction_reps > 0 || row.monologue_sec > 0 || row.recording_sec > 0;
}

/**
 * 連続日数。今日まだ何もしていない場合は昨日から数える
 * （その日のうちに再開できるので、日付が変わるまでは途切れ扱いにしない）。
 */
export function calcStreak(rows: DailyActivity[], today = todayJst()): number {
  const byDate = new Map(rows.map((row) => [row.activity_date, row]));
  let cursor = hasActivity(byDate.get(today)) ? today : shiftDate(today, -1);
  let streak = 0;

  while (hasActivity(byDate.get(cursor))) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

export type HeatmapCell = {
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  reps: number;
  monologueSec: number;
};

/** 直近 weeks 週ぶんのセル（日曜始まりの列） */
export function buildHeatmap(
  rows: DailyActivity[],
  weeks = 12,
  today = todayJst(),
): HeatmapCell[][] {
  const byDate = new Map(rows.map((row) => [row.activity_date, row]));

  // 今週の日曜まで戻る
  const [y, m, d] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const lastSunday = shiftDate(today, -weekday);
  const firstSunday = shiftDate(lastSunday, -(weeks - 1) * 7);

  const columns: HeatmapCell[][] = [];
  for (let w = 0; w < weeks; w += 1) {
    const column: HeatmapCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = shiftDate(firstSunday, w * 7 + day);
      const row = byDate.get(date);
      const score = (row?.reproduction_reps ?? 0) + Math.round((row?.monologue_sec ?? 0) / 60);
      const level: HeatmapCell['level'] =
        score === 0 ? 0 : score < 3 ? 1 : score < 8 ? 2 : score < 20 ? 3 : 4;
      column.push({
        date,
        level,
        reps: row?.reproduction_reps ?? 0,
        monologueSec: row?.monologue_sec ?? 0,
      });
    }
    columns.push(column);
  }
  return columns;
}
