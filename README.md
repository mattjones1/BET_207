# BET_207 · EdgeBoard

A personal sports handicapping research platform for the NFL, FBS college football, and the NBA. It answers five questions:

1. What does the market think will happen?
2. What does my model predict?
3. Why do they disagree?
4. How has the model done in similar spots, in honest out-of-sample tests?
5. Is there enough evidence to look closer at the available price?

**The goal isn't to pick the most winners. It's to measure whether our projections show a repeatable advantage over the market.** EdgeBoard never accepts or places wagers.

- Live: https://mattjones1.github.io/BET_207/ (sign-in required)
- Setup: [docs/SETUP.md](docs/SETUP.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Data: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)

```
npm install
npm run dev        # http://localhost:5207/BET_207/ (demo mode without Supabase env)
npm test           # unit + migration/RLS tests
npm run pipeline -- <job> [--sport nfl] [--dry-run]
```

Data: nflverse (CC-BY-4.0), CollegeFootballData, BALLDONTLIE, The Odds API.
