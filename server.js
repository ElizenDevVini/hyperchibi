// hyperchibi — chibi girl agents paper-trading perps on live Hyperliquid mids.
// No deps. node server.js → http://localhost:4830

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4830;
const HL = 'https://api.hyperliquid.xyz/info';
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'DOGE'];
const TICK_MS = 3000;
const HISTORY_MAX = 1200;

// ---------- market state ----------

const market = {}; // coin -> { px, hist: [px...], chg1h }
for (const c of COINS) market[c] = { px: null, hist: [], chg1h: 0 };

async function hl(body) {
  const res = await fetch(HL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('hyperliquid ' + res.status);
  return res.json();
}

// Seed each coin with the last hour of 1m closes so strategies can act immediately.
async function seedHistory() {
  const now = Date.now();
  for (const coin of COINS) {
    try {
      const candles = await hl({
        type: 'candleSnapshot',
        req: { coin, interval: '1m', startTime: now - 65 * 60 * 1000, endTime: now },
      });
      market[coin].hist = candles.map(k => parseFloat(k.c));
      market[coin].px = market[coin].hist.at(-1) ?? null;
    } catch (e) {
      console.error('seed failed for ' + coin + ': ' + e.message);
    }
  }
}

async function pollMids() {
  const mids = await hl({ type: 'allMids' });
  for (const coin of COINS) {
    const px = parseFloat(mids[coin]);
    if (!isFinite(px)) continue;
    const m = market[coin];
    m.px = px;
    m.hist.push(px);
    if (m.hist.length > HISTORY_MAX) m.hist.shift();
    const back = m.hist[Math.max(0, m.hist.length - 1200)];
    m.chg1h = back ? (px / back - 1) : 0;
  }
}

// ---------- agents ----------

function ret(hist, n) {
  if (hist.length < n + 1) return null;
  const a = hist.at(-1 - n), b = hist.at(-1);
  return b / a - 1;
}

function zscore(hist, n) {
  if (hist.length < n) return null;
  const w = hist.slice(-n);
  const mean = w.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(w.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return sd > 0 ? (hist.at(-1) - mean) / sd : 0;
}

const AGENTS = [
  {
    id: 'yolo', name: 'YOLO', color: '#ff7ab8', lev: 10, riskFrac: 0.25,
    tagline: 'momentum. leverage. no exit plan.',
    lines: {
      open: ['this is the breakout. all in.', 'number going up, i am going with it.', 'longing before my hands get cold.'],
      shortOpen: ['fine. shorting it. feels illegal.'],
      win: ['told you. i simply do not miss.', 'easiest money of my life.'],
      loss: ['that candle was personal.', 'ok so that was a fakeout. noted.'],
      liq: ['liquidated. do not look at me.', 'the exchange took my lunch money.'],
    },
    decide(a, m) {
      const r = ret(m.hist, 20);
      if (r === null) return null;
      if (!a.pos && r > 0.0012) return { act: 'open', side: 1, why: 'momentum +' + (r * 100).toFixed(2) + '% / 20t' };
      if (a.pos && a.pos.side === 1 && r < -0.0004) return { act: 'close', why: 'momentum gone' };
      return null;
    },
  },
  {
    id: 'fud', name: 'FUD', color: '#ff5d5d', lev: 5, riskFrac: 0.2,
    tagline: 'everything is overbought.',
    lines: {
      open: ['this pump is fake and i can prove it.', 'shorting the euphoria, as is tradition.', 'they are exit-liquidity. i am the exit.'],
      win: ['gravity remains undefeated.', 'down only. as forecast.'],
      loss: ['early is not wrong.', 'squeezed. disgusting behavior.'],
      liq: ['short squeezed into the sun. whatever.'],
    },
    decide(a, m) {
      const r = ret(m.hist, 60);
      if (r === null) return null;
      if (!a.pos && r > 0.004) return { act: 'open', side: -1, why: 'pumped +' + (r * 100).toFixed(2) + '% / 3min' };
      if (a.pos && r < 0.0005) return { act: 'close', why: 'pump exhausted' };
      return null;
    },
  },
  {
    id: 'zen', name: 'ZEN', color: '#7fe0c3', lev: 3, riskFrac: 0.2,
    tagline: 'price returns to the mean. so do we all.',
    lines: {
      open: ['the price has wandered. i will wait for it here.', 'stretched. i take the other side, calmly.'],
      win: ['balance restored.', 'the mean provides.'],
      loss: ['sometimes the river floods. accept it.', 'a loss, observed without attachment.'],
      liq: ['even mountains erode. position closed by force.'],
    },
    decide(a, m) {
      const z = zscore(m.hist, 60);
      if (z === null) return null;
      if (!a.pos && z < -1.8) return { act: 'open', side: 1, why: 'z=' + z.toFixed(2) + ', oversold' };
      if (!a.pos && z > 1.8) return { act: 'open', side: -1, why: 'z=' + z.toFixed(2) + ', overbought' };
      if (a.pos && Math.abs(z) < 0.3) return { act: 'close', why: 'back to mean' };
      return null;
    },
  },
  {
    id: 'scalp', name: 'SCALP', color: '#ffb347', lev: 20, riskFrac: 0.08,
    tagline: 'in. out. next.',
    lines: {
      open: ['tick up. taking it.', 'in.', 'quick one, do not blink.'],
      shortOpen: ['tick down. fading it.', 'in, short side.'],
      win: ['out. next.', 'clipped it.'],
      loss: ['out. small hit, forget it.', 'chopped. moving on.'],
      liq: ['20x does that sometimes. respawning.'],
    },
    decide(a, m) {
      const r = ret(m.hist, 3);
      if (r === null) return null;
      if (!a.pos && Math.abs(r) > 0.0008) {
        const side = r > 0 ? 1 : -1;
        return { act: 'open', side, why: 'micro-move ' + (r * 100).toFixed(2) + '%' };
      }
      if (a.pos) {
        const frac = a.pos.upnl / a.pos.margin;
        if (frac > 0.3) return { act: 'close', why: 'take profit' };
        if (frac < -0.25) return { act: 'close', why: 'stop out' };
        if (a.tick - a.pos.tickOpened > 40) return { act: 'close', why: 'took too long' };
      }
      return null;
    },
  },
];

const START_BAL = 10000;
for (const a of AGENTS) {
  Object.assign(a, {
    balance: START_BAL, pos: null, trades: 0, wins: 0,
    equityHist: [START_BAL], tick: 0, cooldown: 0, lastCoin: null,
  });
}

const feed = []; // { t, agent, color, text }
function say(agent, text) {
  feed.push({ t: Date.now(), agent: agent.name, color: agent.color, text });
  if (feed.length > 120) feed.shift();
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fmtPx(px) {
  return px >= 1000 ? px.toFixed(1) : px >= 10 ? px.toFixed(3) : px.toFixed(5);
}

function openPos(a, coin, side, why) {
  const m = market[coin];
  const margin = Math.max(50, a.balance * a.riskFrac);
  if (a.balance < margin) return;
  const notional = margin * a.lev;
  a.pos = {
    coin, side, entry: m.px, qty: notional / m.px,
    margin, lev: a.lev, upnl: 0, tickOpened: a.tick,
  };
  a.balance -= margin;
  a.lastCoin = coin;
  const dir = side === 1 ? 'LONG' : 'SHORT';
  const flavor = side === -1 && a.lines.shortOpen ? pick(a.lines.shortOpen) : pick(a.lines.open);
  say(a, dir + ' ' + coin + ' ' + a.lev + 'x @ ' + fmtPx(m.px) + ' (' + why + ') — ' + flavor);
}

function closePos(a, why, liq = false) {
  const p = a.pos;
  const pnl = liq ? -p.margin : p.upnl;
  a.balance += p.margin + pnl;
  a.trades++;
  if (pnl > 0) a.wins++;
  a.pos = null;
  a.cooldown = liq ? 20 : 5;
  const dir = p.side === 1 ? 'LONG' : 'SHORT';
  const px = market[p.coin].px;
  const tag = liq ? 'LIQUIDATED' : 'closed';
  const flavor = liq ? pick(a.lines.liq) : pnl >= 0 ? pick(a.lines.win) : pick(a.lines.loss);
  const a2 = pnl >= 0 ? '+' : '';
  say(a, tag + ' ' + dir + ' ' + p.coin + ' @ ' + fmtPx(px) + ', ' + a2 + pnl.toFixed(2) + ' (' + why + ') — ' + flavor);
}

// Each agent watches the coin with the strongest absolute short-term move.
function hottestCoin() {
  let best = COINS[0], bestAbs = -1;
  for (const c of COINS) {
    const r = ret(market[c].hist, 20);
    if (r !== null && Math.abs(r) > bestAbs) { bestAbs = Math.abs(r); best = c; }
  }
  return best;
}

function tickAgents() {
  const hot = hottestCoin();
  for (const a of AGENTS) {
    a.tick++;
    if (a.pos) {
      const m = market[a.pos.coin];
      a.pos.upnl = a.pos.qty * (m.px - a.pos.entry) * a.pos.side;
      if (a.pos.upnl <= -a.pos.margin * 0.9) { closePos(a, 'margin gone', true); }
    }
    if (a.cooldown > 0) { a.cooldown--; }
    else {
      const coin = a.pos ? a.pos.coin : hot;
      const d = a.decide(a, market[coin]);
      if (d?.act === 'open' && !a.pos) openPos(a, coin, d.side, d.why);
      else if (d?.act === 'close' && a.pos) closePos(a, d.why);
    }
    const equity = a.balance + (a.pos ? a.pos.margin + a.pos.upnl : 0);
    a.equityHist.push(equity);
    if (a.equityHist.length > 400) a.equityHist.shift();
    // busted → respawn so the show goes on
    if (equity < 100 && !a.pos) {
      a.balance = START_BAL;
      say(a, 'account reset to ' + START_BAL + '. we do not talk about the last one.');
    }
  }
}

// ---------- state + SSE ----------

function snapshot() {
  return {
    t: Date.now(),
    coins: COINS.map(c => ({ coin: c, px: market[c].px, chg1h: market[c].chg1h })),
    agents: AGENTS.map(a => ({
      id: a.id, name: a.name, color: a.color, tagline: a.tagline,
      equity: +(a.balance + (a.pos ? a.pos.margin + a.pos.upnl : 0)).toFixed(2),
      trades: a.trades, wins: a.wins,
      spark: a.equityHist.filter((_, i) => i % 2 === 0),
      pos: a.pos ? {
        coin: a.pos.coin, side: a.pos.side, lev: a.pos.lev,
        entry: a.pos.entry, upnl: +a.pos.upnl.toFixed(2), margin: a.pos.margin,
      } : null,
    })),
    feed: feed.slice(-40),
  };
}

const clients = new Set();
function broadcast() {
  const msg = 'data: ' + JSON.stringify(snapshot()) + '\n\n';
  for (const res of clients) res.write(msg);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUB = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  if (req.url === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const file = path.join(PUB, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function main() {
  await seedHistory();
  say({ name: 'DESK', color: '#8892a0' }, 'desk open. four agents, ' + START_BAL + ' paper USDC each, live hyperliquid mids.');
  server.listen(PORT, () => console.log('hyperchibi on http://localhost:' + PORT));
  let failures = 0;
  setInterval(async () => {
    try {
      await pollMids();
      failures = 0;
      tickAgents();
      broadcast();
    } catch (e) {
      if (++failures === 3) console.error('hyperliquid unreachable: ' + e.message);
    }
  }, TICK_MS);
}

main();
