# SiGit

![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

SiGit lahir dari meme developer Indonesia: konon, developer "senior pro" simpan code-nya di Google Drive, bukan di GitHub. SiGit mewujudkan semangat meme itu dengan cara yang sehat: repo Git self-hosted, sementara file besar (LFS) dan backup tinggal di **storage milik kamu sendiri** (S3, MinIO, R2, Hetzner). Bukan di disk server, bukan di cloud orang lain.

**Project kamu. Storage kamu. History kamu.**

Dokumentasi lengkap (bahasa Inggris) ada di bawah.

---

## English

### What is SiGit?

SiGit is a **self-hosted Git platform** for developers who want to own their entire stack. It is a git server (smart HTTP, so plain `git` works) where the repository history lives on your server, but the heavy stuff lives in **your own storage**:

- **Large files** (git-lfs objects) are stored in your S3-compatible storage (S3, MinIO, R2, Hetzner), not on the server disk.
- **Backups** are automatic: every accepted push updates a `backup.bundle` in your storage.

The server stays small, the history stays complete, and the data stays yours.

**Your project. Your storage. Your history.**

### Screenshot

_Coming soon - dashboard screenshot._

### How it works

```
Developer (git + git-lfs)
    |
    |  git push http://<server>/projects/<name>.git
    v
SiGit server (Bun + Hono)
    |
    |-- bare repo            (history only, stays small)
    |-- pre-receive hook     (rejects big non-LFS blobs)
    |-- LFS objects          (SHA-256 verified)
    |-- backup.bundle        (updated on every push)
    v
Your storage (S3 / MinIO / R2 / Hetzner)
```

### Quick Start

Prerequisites: [Bun](https://bun.sh), PostgreSQL, Git CLI, and any S3-compatible storage ([MinIO](https://min.io) works great for local development).

```bash
# 1. Clone and install backend
git clone https://github.com/rmwahid/sigit.git
cd sigit/backend
bun install

# 2. Environment
cp .env.example .env
#    - set DATABASE_URL (create the database first, e.g. `createdb sigit`)
#    - set ENCRYPTION_KEYS, generate a key with:
#      bun -e "console.log(JSON.stringify({v1: crypto.randomBytes(32).toString('hex')})); process.exit(0)"

# 3. Database
bun run db:migrate
bun run db:create-admin      # creates the admin account (email + password)

# 4. Run the API
bun run dev                  # http://localhost:3000

# 5. Frontend (new terminal)
cd ../frontend
bun install
cp .env.example .env
bun run dev                  # http://localhost:5173
```

Then, in the web UI:

1. Create a project and connect your storage (for local MinIO: endpoint `http://127.0.0.1:9000`, force path style, `minioadmin`/`minioadmin`).
2. Create a token in **Settings -> Tokens**. The token is your git password.
3. Push from your machine:

```bash
git remote add sigit http://localhost:3000/projects/<project-name>.git
git lfs install && git lfs track "*.mp4"    # optional, only for large files
git push sigit main                         # username: <token-name>, password: <token>
```

### Tech Stack

| Layer        | Tech                                    |
| ------------ | --------------------------------------- |
| Runtime      | [Bun](https://bun.sh)                   |
| Backend      | [Hono](https://hono.dev) + Zod + OpenAPI |
| ORM          | [Drizzle ORM](https://orm.drizzle.team) |
| Database     | PostgreSQL                              |
| S3 client    | `@aws-sdk/client-s3`                    |
| Frontend     | [SvelteKit](https://kit.svelte.dev)     |
| Diff viewer  | [diff2html](https://diff2html.xyz)      |

### Project Structure

```
.
├── backend/     # Hono API: auth, tokens, projects, git smart HTTP, LFS server, storage
│   ├── src/
│   │   ├── modules/     # auth, git, lfs, projects, storage
│   │   ├── routes/      # API routes (OpenAPI)
│   │   └── db/          # Drizzle schema + migrations
│   └── tests/
└── frontend/    # SvelteKit UI: dashboard, history, diff viewer, tokens
    └── src/
        ├── routes/
        └── lib/
```

### Roadmap

- [x] **Git smart HTTP** - push, pull, and clone with plain `git`. No custom client, no plugin, no agent install.
- [x] **Token-based auth** - one token works for both git and git-lfs (Basic auth). Tokens are managed in the web UI.
- [x] **Bare repos with a `pre-receive` hook** - rejects non-LFS blobs above a per-project threshold, so big files never bloat the server history.
- [x] **Git LFS server** - full batch/upload/download/verify protocol; objects are stored in your storage at `projects/{id}/lfs/{oid}` with SHA-256 verification.
- [x] **Automatic backups** - every accepted push updates `projects/{id}/backup.bundle` in your storage.
- [x] **Unique project names** - projects live at `/projects/<name>.git`.
- [x] **Web UI** - dashboard, commit history, line-by-line diff viewer (diff2html), token management.
- [x] **Secrets encrypted at rest** - S3 credentials encrypted with AES-256-GCM; env managed with SOPS.
- [x] **Project page setup snippet** - one-click copy of the `git remote add` and `git lfs track` commands for each project.
- [x] **Per-project token scopes** - tokens grant read/write per project; no global tokens. Project pages list which tokens can access them.
- [ ] **Docker Compose deployment** - one-command self-hosting: backend, frontend, Postgres, and optional MinIO.
- [ ] **UI restore from backup** - restore a project from its `backup.bundle` directly in the web UI.
- [ ] **Multi-user and permissions** - roles (admin/member), per-project access, and public projects with anonymous read-only clone.
- [ ] **Webhooks** - push and project events for CI integrations.
- [x] **Encryption at rest** - transparent server-side encryption (per-project AES-256-GCM keys) for LFS objects and `backup.bundle` in your storage.
- [ ] **Branch protection and releases** - protected branches, tags, and downloadable release archives.
- [ ] **SSH authentication** - git and LFS over SSH.
- [ ] **Web-based file browser** - browse repository files per ref.

### License

[MIT](LICENSE)
