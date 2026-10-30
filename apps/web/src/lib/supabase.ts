import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/** The browser client (publishable key). Null in demo mode. */
export const supabase: SupabaseClient | null = env.demo
  ? null
  : createClient(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
