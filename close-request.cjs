// close-request.cjs — mencatat permintaan tutup manual untuk mesin demo 18 koin.
// Dipakai agen saat user bilang "tutup <KOIN>" atau "tutup semua" di chat.
//   node close-request.cjs SOMI     -> minta tutup posisi SOMI
//   node close-request.cjs ALL      -> minta tutup SEMUA posisi terbuka
//   node close-request.cjs --list   -> lihat permintaan yang masih menunggu
//   node close-request.cjs --clear  -> hapus semua permintaan yang menunggu
// Mesin (engine.cjs) membaca file close-requests.json di awal siklus berikutnya
// (cron tiap 15 menit) dan menutup posisi itu di HARGA LIVE segar dengan alasan
// MANUAL-CLOSE — SEBELUM cek TP/SL/trend-exit, jadi tutup manual menang atas
// aturan robot pada run yang sama. Bila harga gagal diambil, permintaan ditahan
// (tidak dihapus) dan tidak ada tutup pada harga basi.
// PAPER / DEMO / VIRTUAL SAJA — tanpa uang asli, tanpa API key exchange.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const FILE = path.join(DIR, 'close-requests.json');
const STATE_FILE = path.join(DIR, 'state.json');
const COINS = ['BTC', 'ETH', 'BNB', 'ENA', 'ONDO', 'XAU', 'SHIB', 'PENGU', 'SUI',
  'XPL', 'PUMP', 'PYTH', 'ZEC', 'ASTER', 'JUP', 'HYPE', 'WCT', 'SOMI'];

function loadRequests() {
  if (!fs.existsSync(FILE)) return [];
  try { const r = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(r) ? r : []; }
  catch (e) { console.error('File close-requests.json rusak:', e.message); process.exit(1); }
}
function openPositions() {
  if (!fs.existsSync(STATE_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).positions || []; }
  catch (e) { console.error('Gagal baca state.json:', e.message); return []; }
}

const arg = (process.argv[2] || '').toUpperCase();
if (arg === '--LIST') {
  const reqs = loadRequests();
  if (!reqs.length) { console.log('Tidak ada permintaan tutup yang menunggu.'); process.exit(0); }
  for (const r of reqs) console.log(`- ${r.coin} (diminta ${r.requestedAt}, via ${r.source || 'chat'})`);
  process.exit(0);
}
if (arg === '--CLEAR') {
  if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  console.log('Semua permintaan tutup yang menunggu dihapus.');
  process.exit(0);
}
if (!arg || (arg !== 'ALL' && !COINS.includes(arg))) {
  console.error('Pakai: node close-request.cjs <KOIN|ALL> | --list | --clear');
  console.error('Koin: ' + COINS.join(', '));
  process.exit(2);
}
const positions = openPositions();
if (arg === 'ALL') {
  if (!positions.length) { console.log('Tidak ada posisi terbuka — tidak ada yang ditutup.'); process.exit(0); }
} else if (!positions.some(p => p.coin === arg)) {
  console.log(`Tidak ada posisi terbuka ${arg} — tidak ada yang ditutup. Posisi terbuka saat ini: ${positions.map(p => p.coin).join(', ') || '(tidak ada)'}.`);
  process.exit(0);
}
const reqs = loadRequests();
if (reqs.some(r => r.coin === arg)) {
  console.log(`Permintaan tutup ${arg} sudah tercatat dan menunggu run mesin berikutnya.`);
  process.exit(0);
}
reqs.push({ coin: arg, requestedAt: new Date().toISOString(), source: 'chat' });
fs.writeFileSync(FILE, JSON.stringify(reqs, null, 2));
console.log(`Permintaan tutup ${arg} dicatat — mesin menutupnya di harga live pada run berikutnya (maks ~15 menit) dengan alasan MANUAL-CLOSE.`);
