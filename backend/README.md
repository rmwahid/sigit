# SiGit API

Backend Hono untuk SiGit — fase 1: Git LFS-like + S3-compatible storage.

## Prasyarat

- Bun
- PostgreSQL
- Git CLI (terinstall di server)

## Setup

1. Copy `.env.example` ke `.env` dan isi credential.
2. Jalankan `bun install`.
3. Jalankan `bun run db:push` untuk sinkronisasi schema.
4. Jalankan `bun run dev`.

## Storage Endpoints

- `GET /storage/connections` — list koneksi
- `POST /storage/connections` — buat koneksi
- `GET /storage/connections/:id` — detail koneksi
- `PATCH /storage/connections/:id` — update koneksi
- `DELETE /storage/connections/:id` — hapus koneksi
- `POST /storage/connections/:id/test` — test koneksi ke S3
- `GET /storage/connections/:id/objects?prefix=` — list objects
- `GET /storage/connections/:id/objects/:key?passphrase=` — download object
- `POST /storage/connections/:id/objects/:key?passphrase=` — upload object
- `DELETE /storage/connections/:id/objects/:key` — hapus object

## Project Endpoints

- `GET /projects` — list project
- `POST /projects` — buat project (otomatis init repo Git lokal)
- `GET /projects/:id` — detail project
- `PATCH /projects/:id` — update project
- `DELETE /projects/:id` — hapus project
- `POST /projects/:id/push?message=&passphrase=` — push file ke project
- `GET /projects/:id/history` — timeline commit project
- `GET /projects/:id/history/:hash/diff` — diff perubahan commit

## Push Workflow

1. Backend menerima form-data files dari frontend.
2. Setiap file dicek apakah masuk LFS (ukuran > threshold atau cocok pattern).
3. File besar: diupload ke S3 dengan key `projects/{projectId}/lfs/{sha256}`, lalu di Git disimpan pointer file LFS.
4. File kecil: disimpan langsung di Git.
5. Semua file di-add dan di-commit ke repo lokal.
6. Riwayat commit bisa dilihat lewat `/projects/:id/history` dan diff-nya lewat `/projects/:id/history/:hash/diff`.

## Enkripsi

Jika project mengaktifkan `useEncryption`, file LFS dienkripsi client-side dengan AES-256-GCM sebelum diupload ke S3. Passphrase diminta per push.
