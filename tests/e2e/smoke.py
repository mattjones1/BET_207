# Browser smoke test in demo mode (real nflverse snapshot, no Supabase).
#   npm run build && (cd apps/web && npx vite preview --port 5208) ; python tests/e2e/smoke.py [base-url]
# Needs Python Playwright (pip install playwright && playwright install chromium).
import asyncio, sys
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5208/BET_207/") + "#/"
R = []
def ok(name, cond, extra=""):
    R.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name, extra)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE); await pg.wait_for_timeout(2500)
        ok("demo banner is shown", await pg.locator("text=DEMO DATA").count() == 1)
        for route, h1 in [("nfl", "NFL"), ("ncaaf", "College Football"), ("nba", "NBA"), ("ratings", "Power Ratings"), ("lab", "Model Lab"), ("backtests", "Backtesting"), ("settings", "Settings")]:
            await pg.goto(BASE + route); await pg.wait_for_timeout(800)
            ok(f"{route} renders", (await pg.inner_text("h1")).startswith(h1))
        await pg.goto(BASE + "nfl"); await pg.wait_for_timeout(2500)
        ok("NFL slate has games", await pg.locator("tbody tr").count() > 0)
        txt = await pg.inner_text("tbody")
        ok("no invented P(cover) without calibration", "%" not in txt)
        await pg.locator("tbody tr a").first.click(); await pg.wait_for_timeout(2500)
        for section in ["Matchup summary", "Team comparison", "Situational", "Market", "Model explanation", "My research notes (private)"]:
            ok(f"game page: {section}", await pg.locator(f"section[aria-label='{section}']").count() == 1)
        await pg.goto(BASE + "backtests"); await pg.wait_for_timeout(2000)
        await pg.click("text=Run walk-forward backtest"); await pg.wait_for_timeout(5000)
        ok("in-browser backtest produces a report", await pg.locator("text=Cover rate by model").count() == 1)
        ph = await b.new_page(viewport={"width": 390, "height": 844})
        await ph.goto(BASE + "nfl"); await ph.wait_for_timeout(2500)
        ok("no horizontal page scroll on a phone", await ph.evaluate("document.documentElement.scrollWidth") <= 390)
        ok("no page errors", not errs, errs[:3])
        await b.close()
    print(f"\n{sum(R)}/{len(R)} passed")
    sys.exit(0 if all(R) else 1)

asyncio.run(main())
