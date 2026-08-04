// hyperchibi — pick a chibi girl, she trades Hyperliquid perps for you.
// Paper accounts on live mids. No deps. node server.js → http://localhost:4830

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4830;
const HL = 'https://api.hyperliquid.xyz/info';
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'DOGE'];
const TICK_MS = 3000;
const HISTORY_MAX = 1200;
const START_BAL = 10000;
const USERS_FILE = path.join(__dirname, 'users.json');

// ---------- market ----------

const market = {}; // coin -> { px, hist, chg1h }
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

function ret(hist, n) {
  if (hist.length < n + 1) return null;
  return hist.at(-1) / hist.at(-1 - n) - 1;
}

function zscore(hist, n) {
  if (hist.length < n) return null;
  const w = hist.slice(-n);
  const mean = w.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(w.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return sd > 0 ? (hist.at(-1) - mean) / sd : 0;
}

// ---------- girls ----------

const GIRLS = [
  {
    id: 'yolo', name: 'YOLO', color: '#ff7ab8', lev: 10, riskFrac: 0.25,
    tagline: 'momentum. leverage. no exit plan.',
    pitch: 'She chases whatever is moving, longs it at 10x, and holds until momentum dies. Big swings both ways.',
    lines: {
      open: ['this is the breakout. all in.', 'number going up, i am going with it.', 'longing before my hands get cold.'],
      shortOpen: ['fine. shorting it. feels illegal.'],
      win: ['told you. i simply do not miss.', 'easiest money of my life.'],
      loss: ['that candle was personal.', 'ok so that was a fakeout. noted.'],
      liq: ['liquidated. do not look at me.', 'the exchange took my lunch money.'],
    },
    decide(acct, m) {
      const r = ret(m.hist, 20);
      if (r === null) return null;
      if (!acct.pos && r > 0.0012) return { act: 'open', side: 1, why: 'momentum +' + (r * 100).toFixed(2) + '% / 20t' };
      if (acct.pos && acct.pos.side === 1 && r < -0.0004) return { act: 'close', why: 'momentum gone' };
      return null;
    },
  },
  {
    id: 'fud', name: 'FUD', color: '#ff5d5d', lev: 5, riskFrac: 0.2,
    tagline: 'everything is overbought.',
    pitch: 'She only shorts. Any 3-minute pump gets faded at 5x, covered when the buyers give up. Thrives in chop, suffers in trends.',
    lines: {
      open: ['this pump is fake and i can prove it.', 'shorting the euphoria, as is tradition.', 'they are exit-liquidity. i am the exit.'],
      win: ['gravity remains undefeated.', 'down only. as forecast.'],
      loss: ['early is not wrong.', 'squeezed. disgusting behavior.'],
      liq: ['short squeezed into the sun. whatever.'],
    },
    decide(acct, m) {
      const r = ret(m.hist, 60);
      if (r === null) return null;
      if (!acct.pos && r > 0.004) return { act: 'open', side: -1, why: 'pumped +' + (r * 100).toFixed(2) + '% / 3min' };
      if (acct.pos && r < 0.0005) return { act: 'close', why: 'pump exhausted' };
      return null;
    },
  },
  {
    id: 'zen', name: 'ZEN', color: '#7fe0c3', lev: 3, riskFrac: 0.2,
    tagline: 'price returns to the mean. so do we all.',
    pitch: 'She waits for price to stretch two standard deviations from its average, takes the other side at a calm 3x, and exits at the mean. The safest of the four.',
    lines: {
      open: ['the price has wandered. i will wait for it here.', 'stretched. i take the other side, calmly.'],
      win: ['balance restored.', 'the mean provides.'],
      loss: ['sometimes the river floods. accept it.', 'a loss, observed without attachment.'],
      liq: ['even mountains erode. position closed by force.'],
    },
    decide(acct, m) {
      const z = zscore(m.hist, 60);
      if (z === null) return null;
      if (!acct.pos && z < -1.8) return { act: 'open', side: 1, why: 'z=' + z.toFixed(2) + ', oversold' };
      if (!acct.pos && z > 1.8) return { act: 'open', side: -1, why: 'z=' + z.toFixed(2) + ', overbought' };
      if (acct.pos && Math.abs(z) < 0.3) return { act: 'close', why: 'back to mean' };
      return null;
    },
  },
  {
    id: 'scalp', name: 'SCALP', color: '#ffb347', lev: 20, riskFrac: 0.08,
    tagline: 'in. out. next.',
    pitch: 'She trades every micro-move at 20x with small size, takes profit fast, cuts losses faster. Dozens of trades an hour.',
    lines: {
      open: ['tick up. taking it.', 'in.', 'quick one, do not blink.'],
      shortOpen: ['tick down. fading it.', 'in, short side.'],
      win: ['out. next.', 'clipped it.'],
      loss: ['out. small hit, forget it.', 'chopped. moving on.'],
      liq: ['20x does that sometimes. respawning.'],
    },
    decide(acct, m) {
      const r = ret(m.hist, 3);
      if (r === null) return null;
      if (!acct.pos && Math.abs(r) > 0.0008) {
        return { act: 'open', side: r > 0 ? 1 : -1, why: 'micro-move ' + (r * 100).toFixed(2) + '%' };
      }
      if (acct.pos) {
        const frac = acct.pos.upnl / acct.pos.margin;
        if (frac > 0.3) return { act: 'close', why: 'take profit' };
        if (frac < -0.25) return { act: 'close', why: 'stop out' };
        if (acct.tick - acct.pos.tickOpened > 40) return { act: 'close', why: 'took too long' };
      }
      return null;
    },
  },
];

const girlById = Object.fromEntries(GIRLS.map(g => [g.id, g]));

// ---------- accounts ----------

function mkAcct(girlId, uid = null) {
  return {
    uid, girlId, balance: START_BAL, pos: null, trades: 0, wins: 0,
    equityHist: [START_BAL], tick: 0, cooldown: 0, feed: [], createdAt: Date.now(),
  };
}

// house accounts: each girl's public track record
for (const g of GIRLS) g.house = mkAcct(g.id);

const users = new Map(); // uid -> acct

function loadUsers() {
  try {
    const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    for (const acct of arr) if (girlById[acct.girlId]) users.set(acct.uid, acct);
    if (users.size) console.log('loaded ' + users.size + ' user accounts');
  } catch { /* first boot */ }
}

let dirty = false;
function saveUsers() {
  fs.writeFile(USERS_FILE, JSON.stringify([...users.values()]), err => {
    if (err) console.error('save failed: ' + err.message);
  });
  dirty = false;
}

const houseFeed = [];
function say(girl, acct, text) {
  const entry = { t: Date.now(), agent: girl.name, color: girl.color, text };
  const feed = acct.uid ? acct.feed : houseFeed;
  feed.push(entry);
  if (feed.length > 120) feed.shift();
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmtPx(px) {
  return px >= 1000 ? px.toFixed(1) : px >= 10 ? px.toFixed(3) : px.toFixed(5);
}

function equity(acct) {
  return acct.balance + (acct.pos ? acct.pos.margin + acct.pos.upnl : 0);
}

function openPos(girl, acct, coin, side, why) {
  const m = market[coin];
  const margin = Math.max(50, acct.balance * girl.riskFrac);
  if (acct.balance < margin) return;
  const notional = margin * girl.lev;
  acct.pos = {
    coin, side, entry: m.px, qty: notional / m.px,
    margin, lev: girl.lev, upnl: 0, tickOpened: acct.tick,
  };
  acct.balance -= margin;
  const dir = side === 1 ? 'LONG' : 'SHORT';
  const flavor = side === -1 && girl.lines.shortOpen ? pick(girl.lines.shortOpen) : pick(girl.lines.open);
  say(girl, acct, dir + ' ' + coin + ' ' + girl.lev + 'x @ ' + fmtPx(m.px) + ' (' + why + ') — ' + flavor);
}

function closePos(girl, acct, why, liq = false) {
  const p = acct.pos;
  const pnl = liq ? -p.margin : p.upnl;
  acct.balance += p.margin + pnl;
  acct.trades++;
  if (pnl > 0) acct.wins++;
  acct.pos = null;
  acct.cooldown = liq ? 20 : 5;
  const dir = p.side === 1 ? 'LONG' : 'SHORT';
  const tag = liq ? 'LIQUIDATED' : 'closed';
  const flavor = liq ? pick(girl.lines.liq) : pnl >= 0 ? pick(girl.lines.win) : pick(girl.lines.loss);
  const sign = pnl >= 0 ? '+' : '';
  say(girl, acct, tag + ' ' + dir + ' ' + p.coin + ' @ ' + fmtPx(market[p.coin].px) + ', ' + sign + pnl.toFixed(2) + ' (' + why + ') — ' + flavor);
}

function hottestCoin() {
  let best = COINS[0], bestAbs = -1;
  for (const c of COINS) {
    const r = ret(market[c].hist, 20);
    if (r !== null && Math.abs(r) > bestAbs) { bestAbs = Math.abs(r); best = c; }
  }
  return best;
}

function tickAccount(girl, acct, hot) {
  acct.tick++;
  if (acct.pos) {
    const m = market[acct.pos.coin];
    acct.pos.upnl = acct.pos.qty * (m.px - acct.pos.entry) * acct.pos.side;
    if (acct.pos.upnl <= -acct.pos.margin * 0.9) closePos(girl, acct, 'margin gone', true);
  }
  if (acct.cooldown > 0) {
    acct.cooldown--;
  } else {
    const coin = acct.pos ? acct.pos.coin : hot;
    const d = girl.decide(acct, market[coin]);
    if (d?.act === 'open' && !acct.pos) openPos(girl, acct, coin, d.side, d.why);
    else if (d?.act === 'close' && acct.pos) closePos(girl, acct, d.why);
  }
  acct.equityHist.push(equity(acct));
  if (acct.equityHist.length > 400) acct.equityHist.shift();
  if (equity(acct) < 100 && !acct.pos) {
    acct.balance = START_BAL;
    say(girl, acct, 'account reset to ' + START_BAL + '. we do not talk about the last one.');
  }
}

function tickAll() {
  const hot = hottestCoin();
  for (const g of GIRLS) tickAccount(g, g.house, hot);
  for (const acct of users.values()) tickAccount(girlById[acct.girlId], acct, hot);
  if (users.size) dirty = true;
}

// ---------- snapshots + SSE ----------

function acctView(acct) {
  return {
    girlId: acct.girlId,
    equity: +equity(acct).toFixed(2),
    trades: acct.trades, wins: acct.wins,
    spark: acct.equityHist.filter((_, i) => i % 2 === 0),
    pos: acct.pos ? {
      coin: acct.pos.coin, side: acct.pos.side, lev: acct.pos.lev,
      entry: acct.pos.entry, upnl: +acct.pos.upnl.toFixed(2), margin: acct.pos.margin,
    } : null,
  };
}

function baseSnapshot() {
  return {
    t: Date.now(),
    coins: COINS.map(c => ({ coin: c, px: market[c].px, chg1h: market[c].chg1h })),
    girls: GIRLS.map(g => ({
      id: g.id, name: g.name, color: g.color, tagline: g.tagline, pitch: g.pitch,
      lev: g.lev, house: acctView(g.house),
    })),
    houseFeed: houseFeed.slice(-30),
    traders: users.size,
  };
}

function personalize(base, uid) {
  const acct = uid && users.get(uid);
  return JSON.stringify({
    ...base,
    you: acct ? { ...acctView(acct), feed: acct.feed.slice(-40) } : null,
  });
}

const clients = new Set(); // { res, uid }
function broadcast() {
  const base = baseSnapshot();
  for (const c of clients) c.res.write('data: ' + personalize(base, c.uid) + '\n\n');
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e4) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUB = path.join(__dirname, 'public');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const client = { res, uid: url.searchParams.get('uid') };
    res.write('data: ' + personalize(baseSnapshot(), client.uid) + '\n\n');
    clients.add(client);
    req.on('close', () => clients.delete(client));
    return;
  }

  if (url.pathname === '/api/join' && req.method === 'POST') {
    const { girl } = await readBody(req);
    if (!girlById[girl]) return json(res, 400, { error: 'unknown girl' });
    const uid = crypto.randomUUID();
    const acct = mkAcct(girl, uid);
    users.set(uid, acct);
    say(girlById[girl], acct, 'hired. ' + START_BAL + ' paper USDC on the desk. give me a minute to read the tape.');
    saveUsers();
    return json(res, 200, { uid });
  }

  if (url.pathname === '/api/quit' && req.method === 'POST') {
    const { uid } = await readBody(req);
    const acct = users.get(uid);
    if (acct) {
      if (acct.pos) closePos(girlById[acct.girlId], acct, 'you fired her');
      users.delete(uid);
      saveUsers();
    }
    return json(res, 200, { ok: true });
  }

  const file = path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function main() {
  loadUsers();
  await seedHistory();
  server.listen(PORT, () => console.log('hyperchibi on http://localhost:' + PORT));
  let failures = 0;
  setInterval(async () => {
    try {
      await pollMids();
      failures = 0;
      tickAll();
      broadcast();
    } catch (e) {
      if (++failures === 3) console.error('hyperliquid unreachable: ' + e.message);
    }
  }, TICK_MS);
  setInterval(() => { if (dirty) saveUsers(); }, 60000);
}

main();
