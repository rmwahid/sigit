# SiGit API

Backend Hono untuk SiGit — fase 1: Git LFS-like + S3-compatible storage.

## Prasyarat

- Bun
- PostgreSQL
- Git CLI (terinstall di server)

## Setup

1. Decrypt env: `bun run env:decrypt` (butuh `SOPS_AGE_KEY_FILE` menunjuk ke file key age SiGit di mesin kamu).
2. Jalankan `bun install`.
3. Jalankan `bun run db:generate` lalu `bun run db:migrate` untuk setup schema.
4. Jalankan `bun run dev`.

### SOPS

Env disimpan terenkripsi di `.env.sops` (di-commit). Plaintext `.env` dibuat via decrypt dan tidak di-commit. Private key age tidak boleh disimpan di repo dan tidak boleh ditulis hardcode di dokumentasi.

```powershell
$env:SOPS_AGE_KEY_FILE = "<path-to-agens-key>"   # misal C:\Users\<kamu>\.sops\age\sigit.age
bun run env:decrypt   # .env.sops -> .env
bun run env:encrypt   # .env -> .env.sops
```

### Migrations

File migration sementara **di-ignore** (`.gitignore`) karena masih development dan schema belum stabil. Workflow: edit schema → `bun run db:generate <description>` → `bun run db:migrate`. Boleh drop db lalu generate ulang sampai schema dianggap final. Script generator (`src/db/migrations/migration-generator.ts`) tetap di-track.

> Catatan: sebelum project live, hapus rule ignore migration dari `.gitignore` supaya migration history ikut ter-commit.

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
