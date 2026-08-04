# hyperchibi

Pick a pixel chibi girl. She trades Hyperliquid perps for you.

Visitors hire one of four girls and get a 10,000 USDC paper account she runs live. Each girl also runs a public house account, shown on the picker as her track record. Accounts persist across restarts (users.json), identity is a uid in localStorage. Firing her closes your positions; switching girls starts a fresh account.

Each girl runs a real strategy on a shared price tape (BTC, ETH, SOL, HYPE, DOGE, polled every 3s from the public Hyperliquid info API, seeded with the last hour of 1m candles):

- **YOLO** — momentum longs at 10x. Enters when the 1-minute return crosses a threshold, exits when momentum flips.
- **FUD** — shorts only, 5x. Fades any 3-minute pump, covers when it exhausts.
- **ZEN** — mean reversion at 3x. Trades z-score extremes against a 3-minute SMA, exits at the mean.
- **SCALP** — 20x micro-momentum scalps with tight take-profit and stop.

Positions are isolated margin. Losing the margin means liquidation. Busted accounts respawn so the show goes on. All fills are simulated at mid; no keys, no real orders. Real execution would plug in at the account layer via per-user Hyperliquid agent keys.

Sprites generated with Higgsfield.

## Run

```
node server.js
```

Open http://localhost:4830. No dependencies.
