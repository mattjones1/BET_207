/** Slot keys for walk-forward refits. */

const etParts = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Eastern calendar date, YYYY-MM-DD. */
export function etDateKey(iso: string): string {
  return etParts(iso);
}

/** Football week: the Tuesday (Eastern) on or before the game. Thursday–Monday games share a week. */
export function footballWeekKey(iso: string): string {
  const d = new Date(`${etParts(iso)}T12:00:00Z`);
  const back = (d.getUTCDay() - 2 + 7) % 7;   // 2 = Tuesday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
