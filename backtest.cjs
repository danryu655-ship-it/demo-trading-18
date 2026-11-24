// Backtest demo 18 koin — 7 hari terakhir, candle 1 jam, simulasi portofolio bersama.
// Aturan SAMA dengan engine.cjs, kecuali satu aproksimasi yang dilabeli jujur di output:
//   Bias Momentum di backtest dihitung dari candle 1 JAM (RSI 1 jam, EMA20/50 1 jam,
//   momentum 1 jam), karena data 1 menit 7 hari untuk 18 koin terlalu berat untuk
//   backtest cepat. Di LIVE, bias dihitung dari candle 1 menit persis seperti Market Move.
//   Jadi angka backtest ini hanya indikasi kasar, bukan janji.
// Entry LONG: EMA9 cross UP di atas EMA21 + close > EMA50 + bias(1 jam) > 55 + RSI 14 (1 jam) <= 70.
// Entry SHORT (cerminan, v2 24 Nov 2026): EMA9 cross DOWN di bawah EMA21 + close < EMA50
//   + bias(1 jam) < 45 + RSI 14 (1 jam) >= 30. SL short = entry + 1,5x ATR, TP short = entry - 2R,
//   keluar tren short saat cross UP. P/L short = (entry - exit) * qty.
//   Masuk di open candle berikutnya. SL 1,5x ATR(14), TP 2R.
//   Risiko 0,4% saldo bersama per trade, maks 3 posisi total long+short (1 per koin),
//   fee 0,06% + slip 0,02%. Bila SL dan TP sama-sama kena dalam satu candle: SL dulu (konservatif).
// Data: Binance public (data-api.binance.vision) dengan fallback Binance US / OKX / Gate.io.
const COINS = [
  { s: 'BTC' }, { s: 'ETH' }, { s: 'BNB' }, { s: 'ENA' }, { s: 'ONDO' },
  { s: 'XAU', binance: 'PAXGUSDT', okx: 'PAXG', gate: 'PAXG' },
  { s: 'SHIB' }, { s: 'PENGU' }, { s: 'SUI' }, { s: 'XPL', noUS: true }, { s: 'PUMP' },
  { s: 'PYTH', noUS: true }, { s: 'ZEC' }, { s: 'ASTER' }, { s: 'JUP' }, { s: 'HYPE' },
  { s: 'WCT', noUS: true }, { s: 'SOMI', noUS: true, noOKX: true },
];
const binSym = c => c.binance || (c.s + 'USDT');
const okxBase = c => c.okx || c.s;
const gateBase = c => c.gate || c.s;
const FEE = 0.0006, SLIP = 0.0002, START = 1000, RISK = 0.004;
const DAYS = 7, WARMUP = 50;

async function fetchJson(url, ms = 15000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
const parseBinance = a => a.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
const parseOKX = a => a.slice().reverse().map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
const parseGate = a => a.map(k => ({ t: +k[0] * 1000, c: +k[2], h: +k[3], l: +k[4], o: +k[5] }));
async function fetchH1(coin, startTime) {
  const attempts = [
    () => fetchJson(`https://data-api.binance.vision/api/v3/klines?symbol=${binSym(coin)}&interval=1h&limit=1000&startTime=${startTime}`).then(parseBinance),
    ...(coin.noUS ? [] : [() => fetchJson(`https://api.binance.us/api/v3/klines?symbol=${binSym(coin)}&interval=1h&limit=1000&startTime=${startTime}`).then(parseBinance)]),
    ...(coin.noOKX ? [] : [() => fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${okxBase(coin)}-USDT&bar=1H&limit=300&after=${startTime + 3600000}`).then(j => { if (j.code !== '0' || !j.data.length) throw new Error('OKX kosong'); return parseOKX(j.data); })]),
    () => fetchJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${gateBase(coin)}_USDT&interval=1h&limit=1000&from=${Math.floor(startTime / 1000)}`).then(parseGate),
  ];
  let lastErr = null;
  for (const fn of attempts) { try { const r = await fn(); if (r && r.length >= 100) return r; } catch (e) { lastErr = e; } }
  throw lastErr || new Error('semua sumber gagal');
}
function emaSeries(closes, p) {
  const k = 2 / (p + 1), out = new Array(closes.length).fill(null);
  let seed = 0;
  for (let i = 0; i < p; i++) seed += closes[i];
  out[p - 1] = seed / p;
  for (let i = p; i < closes.length; i++) out[i] = closes[i] * k + out[i - 1] * (1 - k);
  return out;
}
function atrSeries(cs, p = 14) {
  const tr = [null];
  for (let i = 1; i < cs.length; i++) tr.push(Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c)));
  const out = new Array(cs.length).fill(null);
  let seed = 0;
  for (let i = 1; i <= p; i++) seed += tr[i];
  out[p] = seed / p;
  for (let i = p + 1; i < cs.length; i++) out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  return out;
}
function rsiWilder(closes, p = 14) {
  if (closes.length <= p) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= p; l /= p;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p; l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}
function bias1h(closes, price, i, e20, e50, rsi) {
  const chg = (closes[i] - closes[i - 1]) / closes[i - 1] * 100;
  let score = 50;
  if (rsi !== null) score += (rsi - 50) * 0.55;
  if (e50[i]) score += Math.max(-14, Math.min(14, (e20[i] - e50[i]) / e50[i] * 2200));
  score += (price > e20[i]) ? 6 : -6;
  score += Math.max(-12, Math.min(12, chg * 1.6));
  return Math.max(2, Math.min(98, Math.round(score)));
}

async function main() {
  const end = Date.now();
  const start = end - (DAYS + 3) * 24 * 60 * 60 * 1000; // +3 hari warmup
  const data = {};
  const failed = [];
  for (const coin of COINS) {
    try {
      let cs = await fetchH1(coin, start);
      cs = cs.filter(c => c.t < end - 3600000).sort((a, b) => a.t - b.t); // buang candle berjalan
      const seen = new Set();
      data[coin.s] = cs.filter(c => { if (seen.has(c.t)) return false; seen.add(c.t); return true; });
    } catch (e) { failed.push(coin.s + ': ' + e.message); }
  }
  const ref = data.BTC || Object.values(data)[0];
  if (!ref) throw new Error('Tidak ada data sama sekali: ' + failed.join(' | '));
  const times = ref.map(c => c.t);
  // siapkan indikator per koin, diindeks oleh timestamp acuan
  const per = {};
  for (const [sym, cs] of Object.entries(data)) {
    const byT = new Map(cs.map(c => [c.t, c]));
    const aligned = times.map(t => byT.get(t) || null);
    const closes = aligned.map(c => c ? c.c : null);
    // isi gap kecil dengan close sebelumnya (hanya untuk indikator; trade butuh candle asli)
    let last = null;
    const filled = closes.map(c => { if (c !== null) last = c; return last; });
    per[sym] = { aligned, closes: filled,
      ema9: emaSeries(filled, 9), ema21: emaSeries(filled, 21), ema50: emaSeries(filled, 50),
      ema20: emaSeries(filled, 20), atr: atrSeries(aligned.map(c => c || { o: 0, h: 0, l: 0, c: 0 }), 14) };
    per[sym].rsi = [];
    for (let i = 0; i < filled.length; i++) per[sym].rsi.push(rsiWilder(filled.slice(0, i + 1), 14));
  }
  const fromIdx = times.findIndex(t => t >= end - DAYS * 24 * 60 * 60 * 1000);
  let balance = START, peak = START, maxDD = 0, trades = [], open = {};
  const perCoin = {};
  for (let i = Math.max(WARMUP, fromIdx); i < times.length; i++) {
    // 1) kelola posisi terbuka terhadap candle i (arah-aware)
    for (const sym of Object.keys(open)) {
      const p = open[sym], c = per[sym].aligned[i];
      if (!c) continue;
      const isShort = p.side === 'short';
      const crossDown = per[sym].ema9[i - 1] >= per[sym].ema21[i - 1] && per[sym].ema9[i] < per[sym].ema21[i];
      const crossUp = per[sym].ema9[i - 1] <= per[sym].ema21[i - 1] && per[sym].ema9[i] > per[sym].ema21[i];
      let exit = null, reason = '';
      if (isShort) {
        if (c.h >= p.sl) { exit = p.sl; reason = 'SL'; }
        else if (c.l <= p.tp) { exit = p.tp; reason = 'TP'; }
        else if (crossUp) { exit = c.c; reason = 'TREND-EXIT'; }
      } else {
        if (c.l <= p.sl) { exit = p.sl; reason = 'SL'; }
        else if (c.h >= p.tp) { exit = p.tp; reason = 'TP'; }
        else if (crossDown) { exit = c.c; reason = 'TREND-EXIT'; }
      }
      if (exit !== null) {
        const exitFill = isShort ? exit * (1 + SLIP) : exit * (1 - SLIP);
        const gross = isShort ? p.qty * (p.entry - exitFill) : p.qty * (exitFill - p.entry);
        const net = gross - (p.entry * p.qty + exitFill * p.qty) * FEE;
        balance += net; peak = Math.max(peak, balance); maxDD = Math.max(maxDD, (peak - balance) / peak);
        trades.push({ coin: sym, side: p.side, entry: new Date(p.entryTime).toISOString().slice(0, 16), exit: new Date(c.t).toISOString().slice(0, 16),
          entryPrice: p.entry, exitPrice: +exitFill.toPrecision(6), reason, net: +net.toFixed(4), r: +(net / p.riskUsd).toFixed(2), balance: +balance.toFixed(2) });
        perCoin[sym] = (perCoin[sym] || 0) + 1;
        delete open[sym];
      }
    }
    // 2) sinyal baru
    if (Object.keys(open).length >= 3 || i + 1 >= times.length) continue;
    for (const sym of Object.keys(per)) {
      if (open[sym] || Object.keys(open).length >= 3) continue;
      const P = per[sym], c = P.aligned[i];
      if (!c) continue;
      const crossUp = P.ema9[i - 1] <= P.ema21[i - 1] && P.ema9[i] > P.ema21[i];
      const crossDown = P.ema9[i - 1] >= P.ema21[i - 1] && P.ema9[i] < P.ema21[i];
      const bias = bias1h(P.closes, c.c, i, P.ema20, P.ema50, P.rsi[i]);
      const atrV = P.atr[i];
      if (!atrV || atrV <= 0 || P.rsi[i] === null) continue;
      const riskUsd = balance * RISK;
      const next = P.aligned[i + 1];
      if (crossUp && c.c > P.ema50[i] && bias > 55 && P.rsi[i] <= 70) {
        if (!next) continue;
        const entryFill = next.o * (1 + SLIP);
        const sl = entryFill - 1.5 * atrV;
        open[sym] = { side: 'long', entry: entryFill, sl, tp: entryFill + 2 * (entryFill - sl),
          qty: +((riskUsd / (entryFill - sl)).toPrecision(6)), riskUsd, entryTime: next.t };
      } else if (crossDown && c.c < P.ema50[i] && bias < 45 && P.rsi[i] >= 30) {
        if (!next) continue;
        const entryFill = next.o * (1 - SLIP);
        const sl = entryFill + 1.5 * atrV;
        open[sym] = { side: 'short', entry: entryFill, sl, tp: entryFill - 2 * (sl - entryFill),
          qty: +((riskUsd / (sl - entryFill)).toPrecision(6)), riskUsd, entryTime: next.t };
      }
    }
  }
  // posisi terbuka di akhir -> mark-to-market (arah-aware)
  for (const [sym, p] of Object.entries(open)) {
    const last = per[sym].aligned[times.length - 1];
    const isShort = p.side === 'short';
    const exitFill = isShort ? last.c * (1 + SLIP) : last.c * (1 - SLIP);
    const gross = isShort ? p.qty * (p.entry - exitFill) : p.qty * (exitFill - p.entry);
    const net = gross - (p.entry * p.qty + exitFill * p.qty) * FEE;
    balance += net;
    trades.push({ coin: sym, side: p.side, entry: new Date(p.entryTime).toISOString().slice(0, 16), exit: 'OPEN->MTM',
      entryPrice: p.entry, exitPrice: +exitFill.toPrecision(6), reason: 'MTM-AKHIR', net: +net.toFixed(4),
      r: +(net / p.riskUsd).toFixed(2), balance: +balance.toFixed(2) });
  }
  const wins = trades.filter(t => t.net > 0), losses = trades.filter(t => t.net <= 0);
  const longTrades = trades.filter(t => t.side === 'long'), shortTrades = trades.filter(t => t.side === 'short');
  const longWins = longTrades.filter(t => t.net > 0).length, shortWins = shortTrades.filter(t => t.net > 0).length;
  const grossWin = wins.reduce((s, t) => s + t.net, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.net, 0));
  console.log(JSON.stringify({
    note: 'BACKTEST 7 HARI, 1 jam, bias dihitung dari candle 1 jam (aproksimasi). Di LIVE bias dari candle 1 menit seperti Market Move. Bukan janji profit.',
    variant: 'TF=1h SL=1.5xATR TP=2R LONG: cross-up close>EMA50 bias>55 rsi<=70 | SHORT: cross-down close<EMA50 bias<45 rsi>=30 long+short max3pos risk0.4%',
    periodDays: DAYS, startBalance: START, failedCoins: failed,
    trades: trades.length, wins: wins.length, losses: losses.length,
    longTrades: longTrades.length, longWins, shortTrades: shortTrades.length, shortWins,
    winRate: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? 999 : 0),
    finalBalance: +balance.toFixed(2), returnPct: +((balance / START - 1) * 100).toFixed(2),
    maxDrawdownPct: +(maxDD * 100).toFixed(2),
    tradesPerCoin: perCoin, lastTrades: trades.slice(-10),
  }, null, 2));
}
main().catch(e => { console.error('BACKTEST GAGAL:', e.message); process.exit(1); });
