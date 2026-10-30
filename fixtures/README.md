# Fixtures

- `nflverse/`: **recorded** real rows (trimmed) from nflverse on October 30, 2026 (CC-BY-4.0).
- `cfbd/`, `balldontlie/`, `odds-api/`: **shape fixtures** built from each provider's published schema or
  documentation example (no API keys yet). Team names and numbers are illustrative, not real lines.
  Re-record them from real responses once keys are configured (`npm run pipeline -- record-fixtures`).
- `demo/`: the labeled demo dataset shown when Supabase isn't configured (generated from real nflverse data by
  `npm run pipeline -- export-demo`).
