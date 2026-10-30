import { formatAmerican, formatFavorite, homeSpreadFromMargin, formatSpreadNumber } from "@bet207/core";

export function kickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "KC −3" from a market home margin, with labels. */
export function favorite(homeMargin: number | null, home: string, away: string): string {
  return formatFavorite(homeMargin, home, away);
}

/** The home team's spread as a sportsbook shows it, e.g. "−3.5". */
export function homeSpread(homeMargin: number | null): string {
  const s = homeSpreadFromMargin(homeMargin);
  return s === null ? "—" : formatSpreadNumber(s);
}

export const price = formatAmerican;

export function signed(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function pct(p: number | null | undefined, digits = 1): string {
  return p === null || p === undefined || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(digits)}%`;
}
