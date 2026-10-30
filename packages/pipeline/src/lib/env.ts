/** Pipeline environment. Loads the repo-root .env locally; GitHub Actions passes secrets as env vars. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootEnv = resolve(import.meta.dirname, "../../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing ${name}. Set it in .env (local) or as a GitHub Actions secret. See docs/SETUP.md.`);
  return v;
}
