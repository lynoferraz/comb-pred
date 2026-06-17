# CIM — Combinatorial Information Markets

```
Cartesi Rollups Node version: 2.x
```

CIM is a prediction market for **interrelated** events, built as a [Cartesi
Rollups](https://cartesi.io) application. Instead of trading each question in
isolation, CIM keeps one coherent probability model over all of them, so a
forecast on one event automatically updates everything connected to it. It
implements the
[Combinatorial Information Market](https://mason.gmu.edu/~rhanson/combobet.pdf)
design of Robin Hanson, using an Automated Market Maker (AMM) backed by
**junction-tree belief propagation** — users trade by adjusting their
probability beliefs over combinatorial outcomes.

## How it works

- **Forecasts, not shares.** The AMM is in the logarithmic-scoring family: you
  trade by *moving the market's probability* toward your belief. Move a
  probability from 30% to 40% and, if the outcome occurs, you profit in
  proportion to the information your report added. The market depth parameter
  `b` sets how expensive it is to move the price.
- **Combinatorial markets.** Real-world questions are rarely independent
  (inflation influences interest rates; a team winning its group shapes the
  knockout bracket). CIM models all variables jointly, which unlocks
  *conditional forecasts* ("suppose inflation stays above 4%") and *automatic
  propagation* of a report across every related variable.
- **Junction tree under the hood.** Tracking a full joint distribution is
  exponentially expensive, so CIM maintains a junction tree: related variables
  are grouped into cliques linked by shared variables (separators). Belief
  propagation computes exact probabilities while only multiplying small local
  tables. The whole engine runs deterministically inside the Cartesi rollup, so
  every probability update is verifiable on-chain.

For a narrative walkthrough, see the in-app **About** page
(`frontend/app/about/page.tsx`).

## Architecture

### Python backend (`cim/`)

Cartesi rollup application built with the
[cartesapp](https://github.com/prototyp3-dev/cartesapp/) framework.

- `auto_market_maker.py` — `ABAmm` class, the reference AMM implementation using
  pgmpy for junction-tree belief propagation.
- `comb_pred.py` — prediction-market logic: ABI payload models, mutations
  (`initialize_amm`, `add_variable`, `edit_variable`, `resolve_variable`),
  queries and events.
- `model.py` — data models. `admin.py` — admin operations.
- `jt_serializer.py` — junction-tree (de)serialization.
- `settings.py` / `core_settings.py` — configuration.

### Frontend (`frontend/`)

Next.js app. Market models (the single source of truth for variables, states
and clique structure) live in `frontend/market-models/`. Market data loads
lazily, per visible card. See `frontend/.env.example` for deployment
configuration and `CLAUDE.md` for the detailed data-loading model.

## Requirements

- Python 3 and [cartesapp](https://github.com/prototyp3-dev/cartesapp/), a
  high-level framework for Python Cartesi rollup apps.
- Node.js (for the frontend).

## Backend

### Install

```shell
python3 -m venv .venv
. .venv/bin/activate
pip3 install cartesapp[dev]@git+https://github.com/prototyp3-dev/cartesapp@v1.3.0
```

### Setup

Set `ADMIN_ADDRESS` in `cartesi.toml` under the `[machine]` section:

```shell
envs = ["ADMIN_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]
```

### Run

```shell
cartesapp node            # run the app environment
cartesapp node --dev      # dev mode (faster iteration)
```

### Build

```shell
cartesapp build
```

### Tests

```shell
. .venv/bin/activate
pytest tests/test_amm.py   # AMM unit tests (no cartesapp needed)
pytest tests/              # all tests (test_cim_app.py needs cartesapp + cartesapplib)
```

## Frontend

```shell
cd frontend
npm install
npm run dev                # start the dev server
npm run build              # production build (the verification gate)
npm run seed               # seed the chain with the demo model
npm run seed:worldcup      # seed the World Cup model
npm run build:worldcup-model  # regenerate the World Cup model JSON
```

Deployment config is build-time env (`NEXT_PUBLIC_NODE_URL`,
`NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_CHAIN_ID`); copy `frontend/.env.example`
and adjust. The optional runtime `INFO_REGISTRY_URL` serves info JSON for
variables created while the site runs.

## Status

This is a **test version**. Markets are currently resolved by the market
operator, not by decentralized oracles, and the deployment targets a test
network. Do not use real funds — balances, payouts and resolutions exist for
evaluation only.

## References

- [Combinatorial Information Market](https://mason.gmu.edu/~rhanson/combobet.pdf) — Robin Hanson
- [Graphical Model Market Maker for Combinatorial Prediction Markets](https://www.jair.org/index.php/jair/article/view/11249/26447)
- [Pricing Combinatorial Markets for Tournaments](https://5harad.com/papers/tournaments.pdf)
</content>
</invoke>
