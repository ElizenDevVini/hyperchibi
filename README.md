# hyperchibi

Four pixel chibi girls paper-trading perps against live Hyperliquid mids.

Each agent runs a real strategy on a shared price tape (BTC, ETH, SOL, HYPE, DOGE, polled every 3s from the public Hyperliquid info API, seeded with the last hour of 1m candles):

- **YOLO** — momentum longs at 10x. Enters when the 1-minute return crosses a threshold, exits when momentum flips.
- **FUD** — shorts only, 5x. Fades any 3-minute pump, covers when it exhausts.
- **ZEN** — mean reversion at 3x. Trades z-score extremes against a 3-minute SMA, exits at the mean.
- **SCALP** — 20x micro-momentum scalps with tight take-profit and stop.

Positions are isolated margin. Losing the margin means liquidation. Busted accounts respawn so the show goes on. All fills are simulated at mid; no keys, no real orders.

Sprites generated with Higgsfield.

## Run

```
node server.js
```

Open http://localhost:4830. No dependencies.
