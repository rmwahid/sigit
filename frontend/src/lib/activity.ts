// Pure date/grid math for the GitHub-style contribution graph. Tested in
// tests/activity.test.ts.

export type ActivityDay = { date: string; count: number };
export type ActivityCell = { date: string; count: number } | null;

export type ActivityGrid = {
  weeks: ActivityCell[][]; // 53 columns, 7 rows each (index 0 = Sunday)
  months: { label: string; col: number }[];
  total: number;
};

export const ACTIVITY_WEEK_COLUMNS = 53;
export const ACTIVITY_DAYS_PER_WEEK = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// "YYYY-MM-DD" -> UTC midnight ms, or null when not a real calendar date.
export function parseDateKey(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ms;
}

// UTC midnight ms -> "YYYY-MM-DD".
export function dateKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Heat level 0..4 for one cell (0 = no commits).
export function activityLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

// Grid of the current calendar year (Jan 1 to Dec 31) in 53 columns
// (Sunday..Saturday). Cells before Jan 1, after Dec 31, or after today are
// null. Month labels mark the column where the month of the column's Sunday
// changes; the trailing days of the previous year are not labeled.
export function buildActivityGrid(days: ActivityDay[], today = new Date()): ActivityGrid {
  const counts = new Map<string, number>();
  let total = 0;
  for (const day of days) {
    if (parseDateKey(day.date) === null) continue;
    const count = Math.max(0, Math.floor(day.count));
    if (count === 0) continue;
    counts.set(day.date, (counts.get(day.date) ?? 0) + count);
    total += count;
  }
  const year = today.getUTCFullYear();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const yearStartMs = Date.UTC(year, 0, 1);
  const yearEndMs = Date.UTC(year, 11, 31);
  const firstSunday = yearStartMs - new Date(yearStartMs).getUTCDay() * DAY_MS;

  const weeks: ActivityCell[][] = [];
  const months: { label: string; col: number }[] = [];
  let prevMonth = -1;
  for (let col = 0; col < ACTIVITY_WEEK_COLUMNS; col++) {
    const sunday = firstSunday + col * ACTIVITY_DAYS_PER_WEEK * DAY_MS;
    const week: ActivityCell[] = [];
    for (let row = 0; row < ACTIVITY_DAYS_PER_WEEK; row++) {
      const dayMs = sunday + row * DAY_MS;
      if (dayMs < yearStartMs || dayMs > yearEndMs || dayMs > todayMs) {
        week.push(null);
        continue;
      }
      const key = dateKeyOf(dayMs);
      week.push({ date: key, count: counts.get(key) ?? 0 });
    }
    weeks.push(week);
    const sundayDate = new Date(sunday);
    const month = sundayDate.getUTCMonth();
    if (sundayDate.getUTCFullYear() === year && month !== prevMonth) {
      months.push({ label: MONTH_NAMES[month].slice(0, 3), col });
    }
    prevMonth = month;
  }
  return { weeks, months, total };
}
