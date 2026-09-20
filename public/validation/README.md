# Public Validation Static Assets (Phase 9)

This directory contains static validation artifacts (`.json`, `.svg`) served for the offline validation suite:
- **Consumer**: Phase 9 `/validation` web route (standalone validation report page).
- **Rule**: Per Master Context architectural principles, these reference datasets are NEVER imported into runtime engine code under `src/`. Physics modules only validate against oracles offline or within Vitest suites (`tests/`).
- `j_sweep_validation.json`: Tabulated ITTC open-water $K_t, K_q, \eta$ curves vs $J$ computed against XROTOR for Candidate A.
- `j_sweep_validation.svg`: Pre-rendered SVG validation comparison plot.
