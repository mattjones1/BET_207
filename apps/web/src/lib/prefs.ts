import { useState } from "react";

/** Small per-browser preferences (e.g. the selected sportsbook). Server-synced settings live in user_settings. */
export function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const k = `edgeboard.${key}`;
  const [v, setV] = useState<T>(() => {
    try { return (localStorage.getItem(k) as T | null) ?? initial; } catch { return initial; }
  });
  return [v, (next: T) => { setV(next); try { localStorage.setItem(k, next); } catch { /* storage off */ } }];
}
