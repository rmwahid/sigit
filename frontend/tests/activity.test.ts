import { describe, expect, it } from "vitest";
import { activityLevel, buildActivityGrid, parseDateKey } from "$lib/activity";

describe("parseDateKey", () => {
  it("parses valid keys to UTC midnight ms", () => {
    expect(parseDateKey("2026-08-16")).toBe(Date.UTC(2026, 7, 16));
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("16-08-2026")).toBeNull();
    expect(parseDateKey("nope")).toBeNull();
  });
});

describe("activityLevel", () => {
  it("buckets counts into 5 levels", () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(1)).toBe(1);
    expect(activityLevel(2)).toBe(1);
    expect(activityLevel(3)).toBe(2);
    expect(activityLevel(5)).toBe(2);
    expect(activityLevel(6)).toBe(3);
    expect(activityLevel(9)).toBe(3);
    expect(activityLevel(10)).toBe(4);
  });
});

describe("buildActivityGrid", () => {
  const sunday = new Date("2026-08-16T12:00:00Z");

  it("spans the full calendar year with empty cells outside it", () => {
    const grid = buildActivityGrid([], sunday);
    expect(grid.weeks.length).toBe(53);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // Dec 28-31 2025 (before the year) are empty.
    expect(grid.weeks[0][0]).toBeNull();
    expect(grid.weeks[0][4]).toEqual({ date: "2026-01-01", count: 0 });
    // Last column (Dec 27 2026 - Jan 2 2027) is entirely outside the year.
    expect(grid.weeks[52].every((c) => c === null)).toBe(true);
  });

  it("ends the real cells at today and leaves the future empty", () => {
    const grid = buildActivityGrid([], sunday);
    expect(grid.weeks[33][0]).toEqual({ date: "2026-08-16", count: 0 });
    expect(grid.weeks[33][1]).toBeNull();
    expect(grid.weeks[34][0]).toBeNull();
  });

  it("maps counts onto cells, merges duplicates, and sums the total", () => {
    const grid = buildActivityGrid(
      [
        { date: "2026-08-16", count: 3 },
        { date: "2026-08-16", count: 2 },
        { date: "2026-08-15", count: 1 },
        { date: "not-a-date", count: 5 },
      ],
      sunday
    );
    expect(grid.total).toBe(6);
    expect(grid.weeks[33][0]).toEqual({ date: "2026-08-16", count: 5 });
    expect(grid.weeks[32][6]).toEqual({ date: "2026-08-15", count: 1 });
  });

  it("leaves future cells null when today is mid-week", () => {
    const wednesday = new Date("2026-08-19T12:00:00Z");
    const grid = buildActivityGrid([{ date: "2026-08-19", count: 2 }], wednesday);
    expect(grid.weeks[33][3]).toEqual({ date: "2026-08-19", count: 2 });
    expect(grid.weeks[33][4]).toBeNull();
  });

  it("labels Jan through Dec at the first column of each month", () => {
    const grid = buildActivityGrid([], sunday);
    expect(grid.months[0]).toEqual({ label: "Jan", col: 1 });
    const aug = grid.months.find((m) => m.label === "Aug");
    expect(aug?.col).toBe(31);
    const dec = grid.months.find((m) => m.label === "Dec");
    expect(dec?.col).toBe(49);
    expect(grid.months[grid.months.length - 1].label).toBe("Dec");
  });
});
