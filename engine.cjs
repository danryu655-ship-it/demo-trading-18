// Mesin paper/demo trading 18 koin — v2 (long + short). Diubah 24 Nov 2026 atas perintah user.
// PAPER / DEMO / VIRTUAL SAJA — saldo virtual $1.000, TIDAK ada API key exchange,
// TIDAK ada uang asli, TIDAK ada order sungguhan. Semua "trade" hanya catatan di state.json.
// Aturan (sama seperti paper-desk ENA, diperluas ke 18 koin + gate Bias Momentum Market Move):
//   LONG + SHORT (bukan long-only lagi), candle 1 jam.
//   LONG: EMA 9 cross UP di atas EMA 21 DAN close > EMA 50,
//     DAN skor Bias Momentum Market Move > 55 DAN RSI 14 (1 jam) <= 70 (tidak overbought).
//     SL entry - 1,5 x ATR(14), TP entry + 2R, keluar tren saat EMA 9 cross DOWN di bawah EMA 21.
//   SHORT (cerminan long): EMA 9 cross DOWN di bawah EMA 21 DAN close < EMA 50,
//     DAN Bias Momentum < 45 DAN RSI 14 (1 jam) >= 30 (tidak oversold).
//     SL entry + 1,5 x ATR(14), TP entry - 2R, keluar tren saat EMA 9 cross UP di atas EMA 21.
//   Risiko 0,4% saldo per trade, batas rugi harian 2% ($20) + kill switch otomatis,
//   maks 3 posisi terbuka total (long + short berbagi cap, 1 per koin — tidak pernah
//   long dan short koin yang sama sekaligus). Fee 0,06% per sisi + slippage 0,02%.
//   CATATAN REAL: short HANYA simulasi di demo ini. Di trading real, short TIDAK bisa
//   di Spot — butuh Futures/margin, dengan risiko likuidasi dan funding.
// Data: API publik Binance (data-api.binance.vision, tanpa key) dengan rantai fallback
//   Binance US -> OKX -> Gate.io (sama seperti Market Move). Bila semua sumber gagal untuk
//   satu koin, koin itu dilewati pada siklus itu — TIDAK ada trade pada data basi.
//   Bila respons 418/429 (rate limit), siklus dicatat gagal untuk koin itu dan tidak trade.
// Kill switch: (1) otomatis — rugi harian <= -$20: semua posisi ditutup di harga pasar,
//   mesin berhenti sampai hari berikutnya; (2) manual — buat file STOP di folder ini
//   (atau bilang "stop"): semua posisi ditutup di harga pasar, mesin berhenti.
//   Hapus file STOP untuk jalan lagi.
// Sinyal dihitung dari candle 1 jam TERTUTUP terakhir; harga live = close candle 1 menit
//   terakhir (sama seperti Market Move). Bias Momentum dihitung dari candle 1 menit
//   dengan rumus persis Market Move (RSI 1m, EMA20/50 1m, momentum 1 jam).
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const STATE_FILE = path.join(DIR, 'state.json');
const STOP_FILE = path.join(DIR, 'STOP');
const CLOSE_REQ_FILE = path.join(DIR, 'close-requests.json'); // permintaan tutup manual ("tutup <KOIN>" / "tutup semua") — lihat close-request.cjs
const LOG_FILE = path.join(DIR, 'runs.log');

const COINS = [
  { s: 'BTC', name: 'Bitcoin' }, { s: 'ETH', name: 'Ethereum' }, { s: 'BNB', name: 'BNB' },
  { s: 'ENA', name: 'Ethena' }, { s: 'ONDO', name: 'Ondo' },
  { s: 'XAU', name: 'Emas (PAXG)', binance: 'PAXGUSDT', okx: 'PAXG', gate: 'PAXG' },
  { s: 'SHIB', name: 'Shiba Inu' }, { s: 'PENGU', name: 'Pudgy Penguins' }, { s: 'SUI', name: 'Sui' },
  { s: 'XPL', name: 'Plasma', noUS: true }, { s: 'PUMP', name: 'Pump.fun' },
  { s: 'PYTH', name: 'Pyth Network', noUS: true },
  { s: 'ZEC', name: 'Zcash' }, { s: 'ASTER', name: 'Aster' }, { s: 'JUP', name: 'Jupiter' },
  { s: 'HYPE', name: 'Hyperliquid' }, { s: 'WCT', name: 'WalletConnect', noUS: true },
  { s: 'SOMI', name: 'Somnia', noUS: true, noOKX: true },
];
const START_BALANCE = 1000, RISK_PCT = 0.004, DAILY_LOSS_LIMIT = 20;
const FEE = 0.0006, SLIP = 0.0002;
const SL_MULT = 1.5, TP_R = 2, FILTER_EMA = 50, MAX_POSITIONS = 3;
const BIAS_MIN = 55, RSI_MAX = 70; // gate LONG
const BIAS_MAX_SHORT = 45, RSI_MIN_SHORT = 30; // gate SHORT (cerminan long)

const binSym = c => c.binance || (c.s + 'USDT');
const okxBase = c => c.okx || c.s;
const gateBase = c => c.gate || c.s;

function today() { return new Date().toISOString().slice(0, 10); } // tanggal UTC, sama seperti paper-desk ENA
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!Array.isArray(s.positions)) s.positions = s.position ? [s.position] : [];
    delete s.position;
    return s;
  }
  return {
    balance: START_BALANCE, positions: [], trades: [],
    daily: { date: today(), realizedPnl: 0 },
    startedAt: new Date().toISOString(), halted: false, haltReason: null,
    lastRun: null, lastIndicators: {}, dataErrors: [],
    config: { coins: COINS.map(c => binSym(c)), tf: '1h', emaFast: 9, emaSlow: 21, atr: 14,
      filterEma: FILTER_EMA, slMult: SL_MULT, tpR: TP_R, riskPct: RISK_PCT,
      dailyLossLimit: DAILY_LOSS_LIMIT, maxPositions: MAX_POSITIONS,
      directions: ['LONG', 'SHORT'],
      biasMin: BIAS_MIN, rsiMax: RSI_MAX, biasMaxShort: BIAS_MAX_SHORT, rsiMinShort: RSI_MIN_SHORT },
  };
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
function log(line) { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\n'); }
function sig(n) { return +Number(n).toPrecision(6); } // qty/harga dibulatkan ke 6 angka penting

// ---------- HTTP + fallback (sama seperti Market Move) ----------
async function fetchJson(url, ms = 12000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const e = new Error('HTTP ' + r.status + ' ' + body.slice(0, 120));
      e.status = r.status;
      throw e;
    }
    return await r.json();
  } finally { clearTimeout(to); }
}
const parseBinance = arr => arr.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
const parseOKX = arr => arr.slice().reverse().map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
const parseGate = arr => arr.map(k => ({ t: +k[0] * 1000, v: +k[1], c: +k[2], h: +k[3], l: +k[4], o: +k[5] }));
const SOURCES = [
  { id: 'binance', label: 'Binance Spot', ok: () => true,
    m1: c => fetchJson(`https://data-api.binance.vision/api/v3/klines?symbol=${binSym(c)}&interval=1m&limit=300`).then(parseBinance),
    h1: c => fetchJson(`https://data-api.binance.vision/api/v3/klines?symbol=${binSym(c)}&interval=1h&limit=120`).then(parseBinance) },
  { id: 'binanceus', label: 'Binance US', ok: c => !c.noUS,
    m1: c => fetchJson(`https://api.binance.us/api/v3/klines?symbol=${binSym(c)}&interval=1m&limit=300`).then(parseBinance),
    h1: c => fetchJson(`https://api.binance.us/api/v3/klines?symbol=${binSym(c)}&interval=1h&limit=120`).then(parseBinance) },
  { id: 'okx', label: 'OKX', ok: c => !c.noOKX,
    m1: c => fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${okxBase(c)}-USDT&bar=1m&limit=300`).then(j => { if (j.code !== '0' || !j.data || !j.data.length) throw new Error('OKX kosong'); return parseOKX(j.data); }),
    h1: c => fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${okxBase(c)}-USDT&bar=1H&limit=120`).then(j => { if (j.code !== '0' || !j.data || !j.data.length) throw new Error('OKX kosong'); return parseOKX(j.data); }) },
  { id: 'gate', label: 'Gate.io', ok: () => true,
    m1: c => fetchJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${gateBase(c)}_USDT&interval=1m&limit=300`).then(parseGate),
    h1: c => fetchJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${gateBase(c)}_USDT&interval=1h&limit=120`).then(parseGate) },
];
async function fetchCandles(coin) {
  const errors = [];
  for (const src of SOURCES) {
    if (!src.ok(coin)) continue;
    try {
      const m1 = await src.m1(coin);
      if (!m1 || m1.length < 60) throw new Error('data 1m kurang');
      let h1 = null;
      try { h1 = await src.h1(coin); } catch (e) { errors.push(src.label + ' h1: ' + e.message); }
      if (!h1 || h1.length < 60) throw new Error('data 1 jam kurang');
      return { m1, h1, source: src.label };
    } catch (e) { errors.push(src.label + ': ' + e.message); }
  }
  const err = new Error('Semua sumber gagal: ' + errors.join(' | '));
  err.sources = errors;
  throw err;
}

// ---------- Indikator ----------
function emaSeries(closes, period) { // seed SMA, sama seperti paper-desk ENA
  const k = 2 / (period + 1), out = new Array(closes.length).fill(null);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  out[period - 1] = seed / period;
  for (let i = period; i < closes.length; i++) out[i] = closes[i] * k + out[i - 1] * (1 - k);
  return out;
}
function emaSeriesMM(vals, p) { // seed nilai pertama, sama seperti Market Move
  const k = 2 / (p + 1), out = [];
  let e = null;
  for (let i = 0; i < vals.length; i++) { e = (e === null) ? vals[i] : vals[i] * k + e * (1 - k); out.push(e); }
  return out;
}
function atrSeries(candles, period = 14) {
  const tr = [null];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)));
  }
  const out = new Array(candles.length).fill(null);
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  out[period] = seed / period;
  for (let i = period + 1; i < candles.length; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  return out;
}
function rsiWilder(closes, p = 14) {
  if (closes.length <= p) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= p; l /= p;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
    l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / l);
}
function biasScore(m1closes, price) { // rumus persis Market Move (candle 1 menit)
  const e20 = emaSeriesMM(m1closes, 20), e50 = emaSeriesMM(m1closes, 50);
  const rsi = rsiWilder(m1closes, 14);
  const open1h = m1closes.length > 60 ? m1closes[m1closes.length - 61] : m1closes[0];
  const chg1h = (price - open1h) / open1h * 100;
  let score = 50;
  if (rsi !== null) score += (rsi - 50) * 0.55;
  if (e50[e50.length - 1] !== 0) score += Math.max(-14, Math.min(14, (e20[e20.length - 1] - e50[e50.length - 1]) / e50[e50.length - 1] * 2200));
  score += (price > e20[e20.length - 1]) ? 6 : -6;
  score += Math.max(-12, Math.min(12, chg1h * 1.6));
  return { bias: Math.max(2, Math.min(98, Math.round(score))), rsi1m: rsi === null ? null : +rsi.toFixed(1), chg1h: +chg1h.toFixed(2) };
}

function closePosition(state, pos, exitPrice, reason, events, stalePrice = false) {
  const side = (pos.side || 'long').toLowerCase();
  // LONG: jual di exit, slippage menurunkan harga jual. SHORT: beli kembali di exit,
  // slippage menaikkan harga beli kembali. P/L short = (entry - exit) * qty.
  const exitFill = side === 'short' ? exitPrice * (1 + SLIP) : exitPrice * (1 - SLIP);
  const gross = side === 'short' ? pos.qty * (pos.entry - exitFill) : pos.qty * (exitFill - pos.entry);
  const fees = (pos.entry * pos.qty + exitFill * pos.qty) * FEE;
  const net = gross - fees;
  state.balance += net;
  state.daily.realizedPnl += net;
  const trade = { coin: pos.coin, pair: pos.pair, side,
    openedAt: pos.openedAt, closedAt: new Date().toISOString(),
    entry: pos.entry, exit: sig(exitFill), qty: pos.qty, sl: pos.sl, tp: pos.tp,
    reason: stalePrice ? reason + '-STALE-PRICE' : reason,
    net: +net.toFixed(4), r: +(net / pos.riskUsd).toFixed(2), balance: +state.balance.toFixed(2) };
  state.trades.push(trade);
  state.positions = state.positions.filter(p => p.coin !== pos.coin);
  events.push({ type: 'CLOSE', ...trade });
  log(`CLOSE ${side.toUpperCase()} ${pos.coin} ${reason} @ ${exitFill} net ${net.toFixed(2)} bal ${state.balance.toFixed(2)}`);
}

async function main() {
  const state = loadState();
  // Migrasi config state lama (long-only) ke long+short tanpa mereset saldo/trade.
  if (state.config) {
    state.config.directions = ['LONG', 'SHORT'];
    state.config.biasMaxShort = BIAS_MAX_SHORT;
    state.config.rsiMinShort = RSI_MIN_SHORT;
  }
  const events = [];
  const rows = [];
  state.dataErrors = [];
  if (state.daily.date !== today()) {
    state.daily = { date: today(), realizedPnl: 0 };
    if (state.halted && state.haltReason === 'DAILY-LOSS-LIMIT') { state.halted = false; state.haltReason = null; }
  }
  // Kill switch manual — tutup SEMUA posisi di harga pasar, lalu berhenti.
  if (fs.existsSync(STOP_FILE)) {
    for (const pos of [...state.positions]) {
      let price = state.lastIndicators[pos.coin] ? state.lastIndicators[pos.coin].price : pos.entry;
      let stale = true;
      try {
        const coin = COINS.find(c => c.s === pos.coin);
        const { m1 } = await fetchCandles(coin);
        price = m1[m1.length - 1].c; stale = false;
      } catch (e) { log(`STOP: gagal ambil harga ${pos.coin}, pakai harga terakhir tercatat (${price}): ${e.message}`); }
      closePosition(state, pos, price, 'KILL-SWITCH-MANUAL', events, stale);
    }
    state.halted = true; state.haltReason = 'STOP-FILE';
    state.lastRun = new Date().toISOString();
    saveState(state);
    log('HALT manual (file STOP ada).');
    return finish(state, events, rows, 'HALTED-STOP-FILE');
  }
  if (state.halted && state.haltReason === 'DAILY-LOSS-LIMIT') {
    state.lastRun = new Date().toISOString();
    saveState(state);
    return finish(state, events, rows, 'HALTED-DAILY-LOSS');
  }
  // Tutup manual (perintah user via chat "tutup <KOIN>" / "tutup semua", dicatat
  // ke close-requests.json oleh close-request.cjs). Dibaca di awal siklus,
  // SEBELUM cek TP/SL/trend-exit, supaya tutup manual menang atas aturan robot
  // pada run yang sama. Ditutup di harga live segar (candle 1 menit terakhir);
  // bila harga gagal diambil, permintaan DITAHAN (tidak dihapus) dan TIDAK ada
  // tutup pada harga basi. Posisi yang ditutup manual TIDAK dibuka lagi pada
  // siklus yang sama (guard manuallyClosed di bawah).
  const manuallyClosed = new Set();
  if (fs.existsSync(CLOSE_REQ_FILE)) {
    let requests = [];
    try { requests = JSON.parse(fs.readFileSync(CLOSE_REQ_FILE, 'utf8')); }
    catch (e) { log('CLOSE-REQ: file rusak, diabaikan: ' + e.message); requests = []; }
    if (Array.isArray(requests) && requests.length) {
      const remaining = [];
      for (const req of requests) {
        const want = String(req.coin || '').toUpperCase();
        const targets = want === 'ALL' ? [...state.positions] : state.positions.filter(p => p.coin === want);
        if (!targets.length) { log(`CLOSE-REQ: tidak ada posisi terbuka ${want}, permintaan dibuang.`); continue; }
        let failed = false;
        for (const pos of targets) {
          try {
            const coin = COINS.find(c => c.s === pos.coin);
            const { m1 } = await fetchCandles(coin);
            const livePrice = m1[m1.length - 1].c;
            closePosition(state, pos, livePrice, 'MANUAL-CLOSE', events);
            manuallyClosed.add(pos.coin);
          } catch (e) {
            failed = true;
            log(`CLOSE-REQ: gagal ambil harga ${pos.coin}, permintaan ditahan: ${e.message}`);
          }
        }
        if (failed) remaining.push(req);
      }
      if (remaining.length) fs.writeFileSync(CLOSE_REQ_FILE, JSON.stringify(remaining, null, 2));
      else fs.unlinkSync(CLOSE_REQ_FILE);
    }
  }

  for (const coin of COINS) {
    let data;
    try { data = await fetchCandles(coin); }
    catch (e) {
      const rateLimited = /418|429/.test(e.message);
      state.dataErrors.push({ coin: coin.s, error: e.message, rateLimited });
      log(`DATA GAGAL ${coin.s}: ${e.message} — koin dilewati, TIDAK trade pada data basi.`);
      rows.push({ coin: coin.s, pair: binSym(coin), price: null, bias: null, rsi1h: null, status: rateLimited ? 'RATE-LIMIT' : 'DATA-GAGAL' });
      continue;
    }
    const { m1, h1, source } = data;
    const livePrice = m1[m1.length - 1].c;
    const candles = h1.slice(0, -1); // buang candle 1 jam berjalan
    const closes = candles.map(c => c.c);
    const ema9 = emaSeries(closes, 9), ema21 = emaSeries(closes, 21),
          ema50 = emaSeries(closes, FILTER_EMA), atr = atrSeries(candles, 14);
    const i = candles.length - 1;
    const crossedUp = ema9[i - 1] <= ema21[i - 1] && ema9[i] > ema21[i];
    const crossedDown = ema9[i - 1] >= ema21[i - 1] && ema9[i] < ema21[i];
    const atrV = atr[i];
    const rsi1h = rsiWilder(closes, 14);
    const bias = biasScore(m1.map(c => c.c), livePrice);
    state.lastIndicators[coin.s] = { price: livePrice, bias: bias.bias, rsi1h: rsi1h === null ? null : +rsi1h.toFixed(1),
      rsi1m: bias.rsi1m, chg1h: bias.chg1h, ema9: sig(ema9[i]), ema21: sig(ema21[i]), ema50: sig(ema50[i]),
      atr: atrV ? sig(atrV) : null, source, lastClosedCandle: new Date(candles[i].t).toISOString(),
      crossedUp, crossedDown };

    // Kelola posisi terbuka koin ini (arah-aware: SL/TP/trend-exit dibalik untuk SHORT)
    const pos = state.positions.find(p => p.coin === coin.s);
    if (pos) {
      const isShort = (pos.side || 'long').toLowerCase() === 'short';
      let exit = null, reason = '';
      if (isShort) {
        if (livePrice >= pos.sl) { exit = pos.sl; reason = 'SL'; }
        else if (livePrice <= pos.tp) { exit = pos.tp; reason = 'TP'; }
        else if (crossedUp) { exit = livePrice; reason = 'TREND-EXIT'; }
      } else {
        if (livePrice <= pos.sl) { exit = pos.sl; reason = 'SL'; }
        else if (livePrice >= pos.tp) { exit = pos.tp; reason = 'TP'; }
        else if (crossedDown) { exit = livePrice; reason = 'TREND-EXIT'; }
      }
      if (exit !== null) closePosition(state, pos, exit, reason, events);
    }
    // Sinyal baru (hanya bila belum ada posisi di koin ini dan slot masih ada;
    // long + short berbagi cap 3 posisi, tidak pernah long dan short koin yang sama).
    // Koin yang baru ditutup manual pada siklus ini TIDAK dibuka lagi di siklus yang sama.
    const stillOpen = state.positions.find(p => p.coin === coin.s);
    if (!stillOpen && !manuallyClosed.has(coin.s) && state.positions.length < MAX_POSITIONS && atrV && atrV > 0 && rsi1h !== null) {
      const riskUsd = state.balance * RISK_PCT;
      if (crossedUp && closes[i] > ema50[i] && bias.bias > BIAS_MIN && rsi1h <= RSI_MAX) {
        const entryFill = livePrice * (1 + SLIP);
        const sl = entryFill - SL_MULT * atrV;
        const qty = sig(riskUsd / (entryFill - sl));
        const tp = entryFill + TP_R * (entryFill - sl);
        const newPos = { coin: coin.s, pair: binSym(coin), side: 'long', entry: sig(entryFill), qty,
          sl: sig(sl), tp: sig(tp), riskUsd: +riskUsd.toFixed(2), atr: sig(atrV),
          bias: bias.bias, rsi1h: +rsi1h.toFixed(1), openedAt: new Date().toISOString(), source };
        state.positions.push(newPos);
        events.push({ type: 'OPEN', ...newPos, price: livePrice });
        log(`OPEN long ${qty} ${coin.s} @ ${entryFill} SL ${sl} TP ${tp} bias ${bias.bias} rsi1h ${rsi1h.toFixed(1)}`);
      } else if (crossedDown && closes[i] < ema50[i] && bias.bias < BIAS_MAX_SHORT && rsi1h >= RSI_MIN_SHORT) {
        const entryFill = livePrice * (1 - SLIP);
        const sl = entryFill + SL_MULT * atrV;
        const qty = sig(riskUsd / (sl - entryFill));
        const tp = entryFill - TP_R * (sl - entryFill);
        const newPos = { coin: coin.s, pair: binSym(coin), side: 'short', entry: sig(entryFill), qty,
          sl: sig(sl), tp: sig(tp), riskUsd: +riskUsd.toFixed(2), atr: sig(atrV),
          bias: bias.bias, rsi1h: +rsi1h.toFixed(1), openedAt: new Date().toISOString(), source };
        state.positions.push(newPos);
        events.push({ type: 'OPEN', ...newPos, price: livePrice });
        log(`OPEN short ${qty} ${coin.s} @ ${entryFill} SL ${sl} TP ${tp} bias ${bias.bias} rsi1h ${rsi1h.toFixed(1)}`);
      }
    }
    const openPos = state.positions.find(p => p.coin === coin.s);
    rows.push({ coin: coin.s, pair: binSym(coin), price: livePrice, bias: bias.bias, rsi1h: rsi1h === null ? null : +rsi1h.toFixed(1),
      chg1h: bias.chg1h, crossedUp, crossedDown, position: !!openPos,
      side: openPos ? (openPos.side || 'long') : null,
      source, status: 'OK' });
  }

  // Batas rugi harian — tutup semua posisi, lalu berhenti sampai besok.
  if (state.daily.realizedPnl <= -DAILY_LOSS_LIMIT) {
    for (const pos of [...state.positions]) {
      const ind = state.lastIndicators[pos.coin];
      closePosition(state, pos, ind ? ind.price : pos.entry, 'DAILY-LOSS-LIMIT', events, !ind);
    }
    state.halted = true; state.haltReason = 'DAILY-LOSS-LIMIT';
    events.push({ type: 'KILL', reason: 'DAILY-LOSS-LIMIT', dailyPnl: +state.daily.realizedPnl.toFixed(2) });
    log(`KILL otomatis: rugi harian ${state.daily.realizedPnl.toFixed(2)} menyentuh -$${DAILY_LOSS_LIMIT}.`);
  }
  state.lastRun = new Date().toISOString();
  saveState(state);
  const okCoins = rows.filter(r => r.status === 'OK').length;
  log(`RUN ok=${okCoins}/18 gagal=${state.dataErrors.length} pos=${state.positions.length} bal=${state.balance.toFixed(2)} events=${events.length}`);
  return finish(state, events, rows, state.dataErrors.length === COINS.length ? 'DATA-FAILURE-ALL' : 'OK');
}

function finish(state, events, rows, status) {
  const wins = state.trades.filter(t => t.net > 0).length;
  const summary = { status, time: new Date().toISOString(), paper: true, virtual: true,
    balance: +state.balance.toFixed(2), startBalance: START_BALANCE,
    positions: state.positions, openPositions: state.positions.length,
    trades: state.trades.length, wins, winRate: state.trades.length ? +(100 * wins / state.trades.length).toFixed(1) : 0,
    dailyPnl: +state.daily.realizedPnl.toFixed(2), dailyDate: state.daily.date,
    halted: state.halted, haltReason: state.haltReason, dataErrors: state.dataErrors,
    coins: rows, events };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

main().catch(e => { console.error('ENGINE GAGAL:', e.message); process.exit(1); });
