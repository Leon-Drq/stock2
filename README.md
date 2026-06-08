# Stock2

Open-source A-share research workspace built with Next.js.

This repository contains the product shell for data inspection, factor research, strategy experiments, backtesting workflows, radar views, paper-trading dashboards, and AI-assisted stock diagnosis.

## Open-Source Policy

This public version intentionally ships with **no built-in trading strategies**:

- `STRATEGIES` is empty.
- `EXECUTABLE_RADAR_STRATEGIES` is empty.
- `STRATEGY_CANDIDATES` is empty.
- Strategy miner templates and default GitHub searches are disabled.

Bring your own strategy definitions, factors, data sources, and model credentials before using radar, backtest, or paper-trading flows.

## Environment

Create `.env.local` locally. Do not commit secrets.

```bash
QVERIS_API_KEY=
DATABASE_URL=
OPENAI_API_KEY=
```

Only `QVERIS_API_KEY` and `DATABASE_URL` are needed for the data/backtest flows. AI features can use `OPENAI_API_KEY` or a custom model provider from the UI.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
pnpm lint
pnpm build
```

## Disclaimer

This project is for research and engineering demonstration only. It does not provide investment advice.
