/**
 * Game research data: locating a game, private notes, and saved games.
 * Notes and saved games are private (RLS owner = auth.uid()). In demo mode they live in this browser only.
 */
import type { SportKey } from "@bet207/core";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";
import { SPORT_ID, demoSeasons, getSeason } from "./source";

const SPORT_BY_ID: Record<number, SportKey> = Object.fromEntries(Object.entries(SPORT_ID).map(([k, v]) => [v, k as SportKey]));

export async function locateGame(id: string): Promise<{ sport: SportKey; season: number } | null> {
  if (env.demo || !supabase) {
    for (const s of await demoSeasons()) {
      const d = await getSeason("nfl", s);
      if (d.games.some((g) => g.id === id)) return { sport: "nfl", season: s };
    }
    return null;
  }
  const r = await supabase.from("games").select("sport_id,season").eq("id", id).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data ? { sport: SPORT_BY_ID[r.data.sport_id]!, season: r.data.season } : null;
}

export interface Note {
  lean: string; observations: string; injuries: string; disagreement: string;
  wouldConsider: "yes" | "no" | "maybe" | ""; passReasons: string; updatedAt: string | null;
}
export const EMPTY_NOTE: Note = { lean: "", observations: "", injuries: "", disagreement: "", wouldConsider: "", passReasons: "", updatedAt: null };

const local = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } },
};

export async function getNote(gameId: string): Promise<Note> {
  if (env.demo || !supabase) return local.get(`edgeboard.note.${gameId}`, EMPTY_NOTE);
  const r = await supabase.from("research_notes").select("*").eq("game_id", gameId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  const x = r.data;
  return x ? { lean: x.lean ?? "", observations: x.observations ?? "", injuries: x.injuries ?? "", disagreement: x.disagreement ?? "",
    wouldConsider: x.would_consider ?? "", passReasons: x.pass_reasons ?? "", updatedAt: x.updated_at } : EMPTY_NOTE;
}

export async function saveNote(gameId: string, n: Note): Promise<Note> {
  const saved = { ...n, updatedAt: new Date().toISOString() };
  if (env.demo || !supabase) { local.set(`edgeboard.note.${gameId}`, saved); return saved; }
  const r = await supabase.from("research_notes").upsert({
    game_id: gameId, lean: n.lean || null, observations: n.observations || null, injuries: n.injuries || null,
    disagreement: n.disagreement || null, would_consider: n.wouldConsider || null, pass_reasons: n.passReasons || null,
  }, { onConflict: "owner,game_id" }).select("updated_at").single();
  if (r.error) throw new Error(r.error.message);
  return { ...saved, updatedAt: r.data.updated_at };
}

export async function savedGameIds(): Promise<string[]> {
  if (env.demo || !supabase) return local.get<string[]>("edgeboard.saved", []);
  const r = await supabase.from("saved_games").select("game_id").order("created_at", { ascending: false });
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((x) => x.game_id);
}

export async function setSaved(gameId: string, on: boolean): Promise<void> {
  if (env.demo || !supabase) {
    const cur = local.get<string[]>("edgeboard.saved", []);
    local.set("edgeboard.saved", on ? [gameId, ...cur.filter((x) => x !== gameId)] : cur.filter((x) => x !== gameId));
    return;
  }
  const r = on ? await supabase.from("saved_games").upsert({ game_id: gameId }, { onConflict: "owner,game_id" })
    : await supabase.from("saved_games").delete().eq("game_id", gameId);
  if (r.error) throw new Error(r.error.message);
}
