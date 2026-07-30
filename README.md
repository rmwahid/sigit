# SiGit

> "Developer Senior Pro kok simpan code di GitHub, simpan di Google Drive dong."
>
> "Pake SiGit dong."

SiGit (**Storage Integration for Git**) adalah **platform manajemen project berbasis Git** yang menyimpan source code di Git sambil menyimpan asset besar di storage milik kamu sendiri — S3, MinIO, Google Drive, atau storage lain.

**Project kamu. Storage kamu. History kamu.**

## Masalahnya

Developer sekarang harus pindah-pindah platform:

- Source code di Git.
- Asset besar di object storage.
- Dokumen di cloud drive.
- History project tersebar di mana-mana.

SiGit menyatukan semuanya dalam satu platform, jadi kamu tetap memiliki kendali penuh atas data kamu.

## Apa yang Dilakukan SiGit

- Mengelola repository Git.
- Melacak commit history, branch, dan tag.
- Terhubung ke storage eksternal milik kamu sendiri.
- Menyimpan file kecil (source code, konfigurasi) di Git.
- Menyimpan file besar (video, dataset, binary) di storage pilihan kamu.
- Menyimpan timeline project yang lengkap.

## Arsitektur

```
Developer
    |
    v
SiGit Platform
    |
    +-- Git Repository Layer
    |       +-- Commit
    |       +-- Branch
    |       +-- Tag
    |       +-- History
    |
    +-- Storage Layer
            +-- S3 / Hetzner
            +-- MinIO
            +-- Google Drive
            +-- Lainnya
```

## Fokus Saat Ini: Fase 1 — Git LFS + S3 Project History

Kita membangun integrasi S3-compatible terlebih dahulu, dengan Hetzner Object Storage sebagai target utama.

- CRUD koneksi S3.
- CRUD project.
- Setiap project punya repository Git lokal yang terhubung ke satu koneksi S3.
- File kecil masuk ke Git.
- File besar masuk ke S3 melalui sistem pointer mirip Git LFS.
- Push menciptakan commit dan history project.
- Lihat diff commit per baris dengan `diff2html`.
- Enkripsi client-side untuk objek sensitif.

## Tech Stack

- **Runtime:** Bun
- **Backend:** Hono + Drizzle ORM + Zod
- **Database:** PostgreSQL
- **S3 Client:** `@aws-sdk/client-s3`
- **Frontend:** SvelteKit
- **Diff Viewer:** `diff2html`

## Cara Menjalankan

Lihat README di dalam:

- `backend/README.md`
- `frontend/README.md`

## Kenapa SiGit?

Karena jadi developer senior pro artinya memiliki infrastruktur sendiri, bukan menyewa dari orang lain.

---

## About SiGit (English)

SiGit (**Storage Integration for Git**) is a **Git-based project management platform** that stores your source code in Git while keeping large assets in your own storage — S3, MinIO, Google Drive, or whatever you prefer.

**Your project. Your storage. Your history.**

### The Problem

Developers today juggle too many platforms:

- Source code lives in Git.
- Large assets live in object storage.
- Documents live in cloud drives.
- Project history is fragmented everywhere.

SiGit combines them into one platform, so you keep full ownership of your data.

### What SiGit Does

- Manages Git repositories.
- Tracks commit history, branches, and tags.
- Connects to your own external storage.
- Stores small files (source code, configs) in Git.
- Stores large files (videos, datasets, binaries) in your storage of choice.
- Keeps a complete project timeline.

### Current Focus: Phase 1 — Git LFS + S3 Project History

We are building the S3-compatible integration first, with Hetzner Object Storage as the primary target.

- CRUD S3 connections.
- CRUD projects.
- Each project has a local Git repository linked to one S3 connection.
- Small files go to Git.
- Large files go to S3 via a Git LFS-like pointer system.
- Push creates a commit and project history.
- View commit diffs line-by-line with `diff2html`.
- Client-side encryption for sensitive objects.

### Quick Start

See the README files inside:

- `backend/README.md`
- `frontend/README.md`

### Why SiGit?

Because being a senior pro developer means owning your own infrastructure, not renting it.
