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

/**
 * その日を含む週（**月曜始まり**）の月曜日。
 * ホームの「今週」はすべてこれを起点にする（ローリング7日と混ぜない）。
 */
export function weekStartJst(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日 … 6=土
  return shiftDate(isoDate, -((dow + 6) % 7));
}

export function hasActivity(row: DailyActivity | undefined): boolean {
  if (!row) return false;
  return (
    row.reproduction_reps > 0 ||
    row.monologue_sec > 0 ||
    row.recording_sec > 0 ||
    row.composition_reps > 0 ||
    row.study_sec > 0
  );
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

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

export type WeeklyGoalDay = {
  date: string;
  /** 月〜日 */
  label: string;
  studySec: number;
  isToday: boolean;
  /** まだ来ていない日。棒グラフで薄く出す */
  isFuture: boolean;
};

export type WeeklyGoalSummary = {
  weekStart: string;
  weekEnd: string;
  goalSec: number;
  studySec: number;
  /** 0〜1。100%を超えても頭打ちにしない（超過を見せる） */
  ratio: number;
  achieved: boolean;
  remainingSec: number;
  /** 今日を含む残り日数 */
  remainingDays: number;
  /** 残りを残り日数で割った1日あたり。残り0日なら0 */
  perDaySec: number;
  /** 今日の終わりまでに到達しているべき量（ペース） */
  paceSec: number;
  /** ペースに対して足りていないか */
  behind: boolean;
  days: WeeklyGoalDay[];
};

/**
 * 週の学習目標の進捗。表示に必要な値をここで全部出しておき、
 * コンポーネント側では計算しない（曜日境界の計算を1か所に閉じる）。
 *
 * ペースは「今日の終わりまでに `目標 × 経過日数/7`」。
 * 週の途中で「遅れているのか」を判断できるようにするためで、罰ではない。
 */
export function summarizeWeeklyGoal(
  rows: DailyActivity[],
  goalSec: number,
  today = todayJst(),
): WeeklyGoalSummary {
  const weekStart = weekStartJst(today);
  const weekEnd = shiftDate(weekStart, 6);
  const byDate = new Map(rows.map((row) => [row.activity_date, row]));

  const days: WeeklyGoalDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = shiftDate(weekStart, i);
    days.push({
      date,
      label: WEEKDAY_LABELS[i],
      studySec: byDate.get(date)?.study_sec ?? 0,
      isToday: date === today,
      isFuture: date > today,
    });
  }

  const studySec = days.reduce((sum, day) => sum + day.studySec, 0);
  // 今日が週の何日目か（月曜=1）。今日が週外になることは無いが、念のため 1〜7 に丸める
  const elapsedDays = Math.min(7, Math.max(1, days.findIndex((day) => day.isToday) + 1 || 7));
  const remainingDays = 7 - elapsedDays + 1;
  const remainingSec = Math.max(0, goalSec - studySec);
  const paceSec = Math.round((goalSec * elapsedDays) / 7);

  return {
    weekStart,
    weekEnd,
    goalSec,
    studySec,
    ratio: goalSec > 0 ? studySec / goalSec : 0,
    achieved: goalSec > 0 && studySec >= goalSec,
    remainingSec,
    remainingDays,
    perDaySec: remainingDays > 0 ? Math.round(remainingSec / remainingDays) : 0,
    paceSec,
    behind: goalSec > 0 && studySec < paceSec,
    days,
  };
}

export type HeatmapCell = {
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  reps: number;
  monologueSec: number;
  compositionReps: number;
  studySec: number;
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
      // 1rep ≈ 1分 ≈ 瞬間英作文1文 で合算した1次元スコア。rep は「言えた」タップ
      // （意図的な再現）なので再生カウントより希少。実データで再調整する前提の暫定境界。
      //
      // 分の項は「学習時間」と「独り言の話した時間」の**大きいほう**だけを採る。
      // 独り言も学習時間の計測に乗るので、足すと同じ時間を二重に濃くしてしまう。
      const minutes = Math.round(
        Math.max(row?.study_sec ?? 0, row?.monologue_sec ?? 0) / 60,
      );
      const score = (row?.reproduction_reps ?? 0) + minutes + (row?.composition_reps ?? 0);
      const level: HeatmapCell['level'] =
        score === 0 ? 0 : score < 2 ? 1 : score < 5 ? 2 : score < 12 ? 3 : 4;
      column.push({
        date,
        level,
        reps: row?.reproduction_reps ?? 0,
        monologueSec: row?.monologue_sec ?? 0,
        compositionReps: row?.composition_reps ?? 0,
        studySec: row?.study_sec ?? 0,
      });
    }
    columns.push(column);
  }
  return columns;
}
