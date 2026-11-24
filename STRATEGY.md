# Demo Trading 18 Koin — Paper / Virtual

**Status: PAPER / DEMO / VIRTUAL SAJA.** Saldo virtual $1.000, terpisah dari paper-desk ENA.
Tanpa API key exchange, tanpa uang asli, tanpa order sungguhan. Semua "trade" hanya
catatan di `state.json`. Dibuat 24 Nov 2026, mengikuti Market Move.
**Diubah 24 Nov 2026 ~19:07 WIB atas perintah user: dari LONG-ONLY menjadi LONG + SHORT.**

## Aturan strategi (dikunci di kode `engine.cjs`)

- Koin (18): BTC, ETH, BNB, ENA, ONDO, XAU (=PAXGUSDT), SHIB, PENGU, SUI, XPL, PUMP,
  PYTH, ZEC, ASTER, JUP, HYPE, WCT, SOMI
- Timeframe: candle **1 jam** (sinyal dari candle tertutup terakhir)
- Entry LONG: **EMA 9 cross UP di atas EMA 21** DAN close > **EMA 50**
  DAN skor **Bias Momentum Market Move > 55** DAN **RSI 14 (1 jam) <= 70**
  - Stop loss: entry − **1,5 × ATR(14)** · Take profit: entry + **2R**
  - Keluar tren: EMA 9 cross DOWN di bawah EMA 21 → keluar di harga live
- Entry SHORT (cerminan long, ditambahkan 24 Nov 2026): **EMA 9 cross DOWN di bawah EMA 21**
  DAN close < **EMA 50** DAN skor **Bias Momentum Market Move < 45**
  DAN **RSI 14 (1 jam) >= 30**
  - Stop loss: entry + **1,5 × ATR(14)** · Take profit: entry − **2R**
  - Keluar tren: EMA 9 cross UP di atas EMA 21 → keluar di harga live
  - P/L short = (entry − exit) × qty, bukan (exit − entry)
- Bias Momentum dihitung dari candle 1 menit dengan rumus persis Market Move
  (RSI 1 menit, EMA20/50 1 menit, momentum 1 jam) — bukan data futures Long/Short asli
- Risiko: **0,4% saldo per trade** · Maks **3 posisi** terbuka total (long + short
  berbagi cap, 1 per koin — tidak pernah long dan short koin yang sama sekaligus)
- Fee simulasi **0,06%** per sisi + slippage **0,02%**
- Setiap posisi dan trade membawa field arah `side: long | short` (di `state.json`,
  log trade, notifikasi cron, dan dashboard).

## Catatan penting soal SHORT di trading real

- Short di demo ini HANYA simulasi. Di trading real, short **TIDAK bisa di Spot** —
  harus lewat Futures/margin, dengan risiko **likuidasi** (posisi ditutup paksa saat
  harga bergerak melawan) dan **funding fee** berkala. Jangan menyamakan hasil demo
  short dengan hasil real.

## Tutup manual (ditambahkan 24 Nov 2026 ~22:21 WIB atas perintah user; diubah ke instan 24 Nov 2026 ~22:55 WIB)

- Dashboard sekarang **fullstack** (artifact `demo-trading-18`, ada server + database
  internal). Di tiap kartu posisi terbuka ada tombol **"Tutup Sekarang"** di bawah
  (plus "Tutup Semua" bila >1 posisi). Tekan tombol itu → muncul konfirmasi berisi
  koin, arah LONG/SHORT, harga entry, harga live saat ini, P/L kotor, fee 0,06% +
  slippage 0,02%, dan estimasi P/L bersih yang dikunci → konfirmasi → server
  mengambil harga live segar, lalu menutup posisi **langsung saat itu juga** di
  harga live tersebut dengan alasan `MANUAL-CLOSE` (bukan menunggu run cron 15
  menit berikutnya). Bila harga live gagal diambil, posisi TIDAK ditutup pada
  harga basi — tombol menampilkan error dan posisi tetap terbuka.
- Penutupan instan ini menulis langsung ke `state.json` mesin (saldo, P/L harian,
  riwayat trade) dan menyimpannya sebagai snapshot di database artifact, sehingga
  dashboard dan ringkasan cron sepakat soal angka itu. Posisi yang ditutup manual
  tidak dibuka lagi pada siklus mesin yang sama.
- Jalur lama lewat chat tetap ada sebagai cadangan: user bilang `tutup <KOIN>`
  (atau `tutup semua`) di chat ke Rias, Rias mencatatnya lewat
  `node close-request.cjs <KOIN|ALL>` ke file `close-requests.json`; mesin
  (`engine.cjs`) membaca file itu di awal siklus berikutnya (cron tiap 15 menit,
  maks ~15 menit) dan menutup posisi itu di HARGA LIVE segar dengan alasan
  `MANUAL-CLOSE`, SEBELUM cek TP/SL/trend-exit.
- Aturan tutup otomatis robot TIDAK berubah: TP 2R, SL 1,5× ATR, keluar tren EMA,
  kill switch batas rugi harian $20.

## Risk control + kill switch

- Batas rugi harian **2% ($20)**: bila rugi terealisasi hari itu ≤ −$20, semua posisi
  (long maupun short) ditutup di harga pasar dan mesin berhenti sampai hari berikutnya
  (`haltReason: DAILY-LOSS-LIMIT`)
- Kill switch manual: buat file `STOP` di folder ini (atau bilang "stop") — semua
  posisi ditutup di harga pasar, mesin berhenti. Hapus file `STOP` untuk jalan lagi.
- Bila semua sumber data gagal untuk satu koin, koin itu dilewati — TIDAK ada trade
  pada data basi. Respons 418/429 (rate limit) dicatat dan koin dilewati.

## Data

- Binance public (`data-api.binance.vision`, tanpa key) → fallback Binance US → OKX → Gate.io,
  sama seperti Market Move. XAU memakai PAXGUSDT; XPL/PYTH/WCT/SOMI tidak ada di Binance US;
  SOMI tidak ada di OKX.

## File

- `engine.cjs` — mesin live (tiap 15 menit via cron `paper-desk-demo-18-15m`)
- `close-request.cjs` — mencatat permintaan tutup manual (`node close-request.cjs <KOIN|ALL>`, `--list`, `--clear`); mesin membacanya sebagai `close-requests.json` di awal siklus
- `close-requests.json` — (hanya ada saat ada permintaan tutup yang menunggu) daftar permintaan tutup manual yang belum dieksekusi
- `backtest.cjs` — backtest 7 hari, 1 jam (bias diaproksimasi dari candle 1 jam — lihat
  catatan di file itu; di live, bias dari candle 1 menit)
- `backtest-7d-2026-11-24.json` — backtest long-only (sebelum short ditambahkan)
- `backtest-7d-longshort-2026-11-24.json` — backtest long+short (setelah short ditambahkan)
- `state.json` — saldo, posisi, riwayat trade (dibuat otomatis saat pertama jalan)
- `runs.log` — log tiap siklus
- `STOP` — (tidak ada) buat file ini untuk kill switch manual

## Kriteria lulus / berhenti (sama seperti paper-desk ENA)

- Lulus: **profit factor > 1** setelah **30 trade** DAN drawdown dalam batas.
- Berhenti/ganti strategi: bila setelah 2 minggu hasilnya tetap negatif dan
  profit factor < 1 — strategi diganti atau mesin dimatikan, bukan dipertahankan.
- Backtest long-only 7 hari (17–24 Nov): 20 trade, 5 menang, PF 0,61, saldo $976,85 (−2,32%).
  Hasil backtest long+short ada di file `backtest-7d-longshort-2026-11-24.json`.
