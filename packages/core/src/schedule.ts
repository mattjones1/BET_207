/**
 * Schedule-derived facts computed the same way for every sport: rest days and season records.
 * Inputs are plain game lists; nothing here reads the network.
 */

export interface ScheduleGame {
  id: string;
  startTime: string; // ISO
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}

const DAY = 86_400_000;

/** Calendar days between two instants, measured in US Eastern dates (how leagues count rest). */
export function restDays(prevStart: string, nextStart: string): number {
  const d = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    return Date.parse(`${p}T00:00:00Z`);
  };
  return Math.round((d(nextStart) - d(prevStart)) / DAY);
}

/**
 * Days since each team's previous game, for every game. null for a team's first game in the list
 * (unknown, not zero). Back-to-back in the NBA is restDays === 1.
 */
export function computeRest(games: ScheduleGame[]): Map<string, { home: number | null; away: number | null }> {
  const sorted = [...games].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const last = new Map<string, string>();
  const out = new Map<string, { home: number | null; away: number | null }>();
  for (const g of sorted) {
    const h = last.get(g.homeTeamId), a = last.get(g.awayTeamId);
    out.set(g.id, { home: h ? restDays(h, g.startTime) : null, away: a ? restDays(a, g.startTime) : null });
    last.set(g.homeTeamId, g.startTime);
    last.set(g.awayTeamId, g.startTime);
  }
  return out;
}

export interface Record { wins: number; losses: number; ties: number }

/** Win-loss-tie records from completed games that started before `before` (ISO), or all completed games. */
export function records(games: ScheduleGame[], before?: string): Map<string, Record> {
  const rec = new Map<string, Record>();
  const get = (t: string) => rec.get(t) ?? (rec.set(t, { wins: 0, losses: 0, ties: 0 }), rec.get(t)!);
  for (const g of games) {
    if (g.homeScore === null || g.awayScore === null) continue;
    if (before && g.startTime >= before) continue;
    const h = get(g.homeTeamId), a = get(g.awayTeamId);
    if (g.homeScore > g.awayScore) { h.wins++; a.losses++; }
    else if (g.homeScore < g.awayScore) { a.wins++; h.losses++; }
    else { h.ties++; a.ties++; }
  }
  return rec;
}

export function formatRecord(r: Record | undefined): string {
  if (!r) return "0-0";
  return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}
