import { describe, expect, it } from "vitest";
import { computeRest, formatRecord, records, restDays, type ScheduleGame } from "./schedule";

const g = (id: string, start: string, home: string, away: string, hs: number | null = null, as: number | null = null): ScheduleGame =>
  ({ id, startTime: start, homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as });

describe("rest days", () => {
  it("counts Eastern calendar days, so a late tip doesn't add a day", () => {
    // 7:30pm ET Monday (23:30Z) to 7:00pm ET Tuesday (23:00Z) is a back-to-back: 1 day.
    expect(restDays("2026-11-02T23:30:00Z", "2026-11-03T23:00:00Z")).toBe(1);
    // 10:30pm ET (03:30Z next UTC day) still counts as the Eastern date it started.
    expect(restDays("2026-11-03T03:30:00Z", "2026-11-04T00:00:00Z")).toBe(1);
  });
  it("first game has unknown rest (null, not 0); back-to-backs are 1", () => {
    const r = computeRest([
      g("a", "2026-11-01T23:00:00Z", "BOS", "NYK"),
      g("b", "2026-11-02T23:00:00Z", "BOS", "MIA"),
      g("c", "2026-11-05T23:00:00Z", "NYK", "MIA"),
    ]);
    expect(r.get("a")).toEqual({ home: null, away: null });
    expect(r.get("b")).toEqual({ home: 1, away: null });
    expect(r.get("c")).toEqual({ home: 4, away: 3 });
  });
});

describe("records", () => {
  const games = [
    g("1", "2026-09-10T00:00:00Z", "KC", "BAL", 27, 20),
    g("2", "2026-09-17T00:00:00Z", "BAL", "KC", 24, 24),
    g("3", "2026-09-24T00:00:00Z", "KC", "DEN", null, null),
  ];
  it("counts wins, losses, and ties from finished games only", () => {
    const r = records(games);
    expect(formatRecord(r.get("KC"))).toBe("1-0-1");
    expect(formatRecord(r.get("BAL"))).toBe("0-1-1");
    expect(formatRecord(r.get("DEN"))).toBe("0-0");
  });
  it("only counts games before a cutoff (no look-ahead)", () => {
    expect(formatRecord(records(games, "2026-09-15T00:00:00Z").get("KC"))).toBe("1-0");
  });
});
