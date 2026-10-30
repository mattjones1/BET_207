/** Convert a wall-clock date and time in an IANA zone to a UTC ISO string (DST-correct). */
export function zonedToUtc(date: string, time: string, timeZone = "America/New_York"): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = (time || "00:00").split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(at));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - at;
  };
  // Two passes handle the DST boundary.
  let utc = guess - offset(guess);
  utc = guess - offset(utc);
  return new Date(utc).toISOString();
}
