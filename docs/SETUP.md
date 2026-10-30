# Setup

EdgeBoard runs in **demo mode** (labeled sample data) until these steps are done. Nothing secret ever goes in the code.

## 1. GitHub repository and Pages
1. Create an empty **public** repository `mattjones1/BET_207` on github.com (no README).
2. From `C:\Users\mjone\Documents\BET_207`, run `git remote add origin https://github.com/mattjones1/BET_207.git`, then `git push -u origin main`.
3. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. The site appears at https://mattjones1.github.io/BET_207/ (in demo mode until step 2 below).

## 2. Supabase
1. Create a new project at supabase.com.
2. In the **SQL Editor**, run each file in `supabase/migrations/` in order (0001, 0002, 0003…).
3. Under **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". Then **Authentication → Users → Add user** creates your account (email and password).
4. Optional: run `supabase/tests/rls_check.sql` with two test users to confirm privacy (each row should say `ok = true`).
5. **Project Settings → API keys**: copy the project URL, the **publishable** key, and the **secret / service_role** key.

## 3. GitHub settings (Settings → Secrets and variables → Actions)
**Variables** (visible; these go to the browser build):
- `VITE_SUPABASE_URL`: the project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the publishable key

**Secrets** (hidden; pipeline only):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `ODDS_API_KEY` (the-odds-api.com, free plan: 500 credits a month)
- `CFBD_API_KEY` (collegefootballdata.com/key, free: 1,000 calls a month)
- `BALLDONTLIE_API_KEY` (balldontlie.io, free: 5 requests a minute)

## 4. Local development
Copy `.env.example` to `.env` and fill in what you have, then run `npm install` and `npm run dev`. Without Supabase values, the app runs in demo mode.
