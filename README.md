# Demo Trading 18 Koin — PAPER / VIRTUAL ONLY

Mesin paper trading demo 18 koin mengikuti Market Move. **Bukan uang asli.**

- Saldo virtual mulai **$1.000** (per 24 Nov 2026 22:33 WIB: **$1.004,16**, 0 posisi terbuka, 2 trade tertutup, total P/L **+$4,16**).
- Long + short, candle 1 jam, EMA 9/21 + filter EMA50 + Bias Momentum Market Move (> 55 long / < 45 short) + RSI 14 (≤ 70 long / ≥ 30 short).
- SL 1,5× ATR(14), TP 2R, risiko 0,4% per trade, maks 3 posisi, batas rugi harian $20 (kill switch).
- Fee simulasi 0,06% + slippage 0,02% per sisi.
- Tanpa API key exchange, tanpa order sungguhan. Semua "trade" hanya catatan di `state.json` (tidak ikut di-backup di sini).

## Hasil backtest 7 hari (17–24 Nov 2026) — jujur: KALAH

- Long-only: 20 trade, 5 menang (25%), profit factor 0,61, saldo $976,85 (−2,32%).
- Long+short: 30 trade, 9 menang (30%), profit factor 0,77, saldo $980,79 (−1,92%).
- Kriteria lulus: profit factor > 1 setelah 30 trade. Strategi ini **belum lulus** — jangan pakai uang asli.

## File

- `engine.cjs` — mesin live (dijalankan tiap 15 menit oleh cron `paper-desk-demo-18-15m`).
- `close-request.cjs` — mencatat permintaan tutup manual (`node close-request.cjs <KOIN|ALL>`).
- `backtest.cjs` — backtest 7 hari, 1 jam.
- `backtest-7d-2026-11-24.json` — hasil backtest long-only.
- `backtest-7d-longshort-2026-11-24.json` — hasil backtest long+short.
- `STRATEGY.md` — aturan strategi lengkap.
- `demo-trading-18-static-snapshot-2026-11-24.html` — ekspor HTML statis dashboard versi 24 Nov 2026 15:36 WIB (SEBELUM konversi ke fullstack). Ini hanya snapshot tampilan lama, **bukan** dashboard fullstack saat ini.

## Dashboard

Dashboard live adalah artifact fullstack `demo-trading-18` di Muse (bukan GitHub Pages).
GitHub Pages **tidak** bisa menyajikan dashboard fullstack ini — backup di repo ini
hanya kode + dokumen. Sejak 24 Nov 2026 ~22:55 WIB, tombol "Tutup Sekarang" di
dashboard menutup posisi secara instan lewat server action fullstack; alur lama
lewat perintah chat `tutup <KOIN>` tetap ada sebagai cadangan (lihat `STRATEGY.md`
bagian "Tutup manual").

## Data

Binance public (`data-api.binance.vision`, tanpa key) → fallback Binance US → OKX → Gate.io.
XAU memakai PAXGUSDT. Lihat `STRATEGY.md` untuk detail lengkap.
