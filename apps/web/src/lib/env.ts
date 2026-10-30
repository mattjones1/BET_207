/**
 * Browser configuration. Only the Supabase URL and PUBLISHABLE key ever reach the browser; access is
 * enforced by Row Level Security. Demo mode turns on when they're missing or VITE_DEMO=1.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? "";

if (/service_role|sb_secret_/i.test(key)) {
  // Fail loudly rather than ship a privileged key to the browser.
  throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret key. Use the publishable key only.");
}

export const env = {
  supabaseUrl: url,
  supabaseKey: key,
  demo: import.meta.env.VITE_DEMO === "1" || !url || !key,
} as const;
