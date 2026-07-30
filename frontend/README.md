# SiGit UI

Frontend SvelteKit untuk SiGit.

## Setup

1. Copy `.env.example` ke `.env`.
2. Jalankan `bun install`.
3. Jalankan `bun run dev`.

Frontend berjalan di `http://localhost:5173` dan proxy ke backend `http://localhost:3000` via `/api`.

## Diff Viewer

Menggunakan `diff2html` untuk render output `git diff` dari backend.
