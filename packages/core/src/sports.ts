/**
 * Sport registry. Everything sport-specific that isn't a model parameter lives here, so adding a sport
 * means adding one entry (plus adapters), not rebuilding the app.
 */
export type SportKey = "nfl" | "ncaaf" | "nba";

export interface SportInfo {
  key: SportKey;
  name: string;
  short: string;
  /** The Odds API sport key. */
  oddsApiKey: string;
  /** Games are grouped by week (football) or by date (basketball). */
  slate: "week" | "date";
  /** Typical regular-season months (1–12), for skipping odds pulls out of season. */
  seasonMonths: number[];
  /** Conferences are a meaningful filter. */
  hasConferences: boolean;
}

export const SPORTS: Record<SportKey, SportInfo> = {
  nfl: { key: "nfl", name: "NFL", short: "NFL", oddsApiKey: "americanfootball_nfl", slate: "week", seasonMonths: [9, 10, 11, 12, 1, 2], hasConferences: false },
  ncaaf: { key: "ncaaf", name: "College Football", short: "CFB", oddsApiKey: "americanfootball_ncaaf", slate: "week", seasonMonths: [8, 9, 10, 11, 12, 1], hasConferences: true },
  nba: { key: "nba", name: "NBA", short: "NBA", oddsApiKey: "basketball_nba", slate: "date", seasonMonths: [10, 11, 12, 1, 2, 3, 4, 5, 6], hasConferences: false },
};

export const SPORT_KEYS = Object.keys(SPORTS) as SportKey[];

export function isSportKey(s: string): s is SportKey {
  return (SPORT_KEYS as string[]).includes(s);
}

export function inSeason(sport: SportKey, date: Date): boolean {
  return SPORTS[sport].seasonMonths.includes(date.getUTCMonth() + 1);
}

/** Football seasons are named by their starting year; a January playoff game belongs to the previous season. */
export function currentSeason(sport: SportKey, now: Date): number {
  const m = now.getUTCMonth() + 1, y = now.getUTCFullYear();
  if (sport === "nba") return m >= 8 ? y : y - 1;   // 2025 = the 2025–26 season
  return m >= 3 ? y : y - 1;
}
