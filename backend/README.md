# SiGit API

Hono backend for [SiGit](..): authentication, projects, git smart HTTP, Git LFS server, and S3-compatible storage integration.

## Prerequisites

- [Bun](https://bun.sh)
- PostgreSQL
- Git CLI (installed on the server, required for git protocol, hooks, and bundles)
- An S3-compatible storage (S3, MinIO, R2, Hetzner) for LFS objects and backups

## Setup

### For contributors (no SOPS key)

```bash
bun install
cp .env.example .env
#    - set DATABASE_URL (create the database first, e.g. `createdb sigit`)
#    - set ENCRYPTION_KEYS to a JSON map of key versions, generate one with:
#      bun -e "console.log(JSON.stringify({v1: crypto.randomBytes(32).toString('hex')})); process.exit(0)"
bun run db:migrate
bun run db:create-admin
bun run dev
```

### For maintainers (SOPS + age)

Environment is stored encrypted in `.env.sops` (committed); the plaintext `.env` is created by decrypting and is never committed. The age private key lives outside the repo.

```powershell
$env:SOPS_AGE_KEY_FILE = "<path-to-age-key>"
bun run env:decrypt   # .env.sops -> .env
bun run env:encrypt   # .env -> .env.sops (after editing .env)
```

## Environment Variables

| Variable              | Required | Default                   | Description                                             |
| --------------------- | -------- | ------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`        | yes      | -                         | PostgreSQL connection string                            |
| `ENCRYPTION_KEYS`     | yes      | -                         | JSON map `{"v1":"<hex-32-byte-key>"}` for secret encryption |
| `PORT`                | no       | `3000`                    | API port                                                |
| `CORS_ORIGINS`        | no       | `http://localhost:5173`   | Comma-separated allowed origins                         |
| `SESSION_TTL_DAYS`    | no       | `7`                       | Session cookie lifetime                                 |
| `NODE_ENV`            | no       | `development`             | Runtime environment                                     |
| `SIGIT_PROJECTS_ROOT` | no       | `./data/projects`         | Directory for bare repos (git history only)             |
| `LOG_DIR`             | no       | `./data/logs`             | Audit log directory                                     |

Storage connections (S3 endpoints, credentials, buckets) are user input stored in the database, not environment variables. Credentials are encrypted with AES-256-GCM using `ENCRYPTION_KEYS`.

## Database

```bash
bun run db:migrate          # apply migrations
bun run db:generate <desc>  # create a migration (lowercase + underscores)
bun run db:validate         # validate migration filenames
bun run db:create-admin     # create the admin account (first-time setup)
bun run db:reset-password   # reset admin password (revokes all sessions)
bun run db:reencrypt        # re-encrypt secrets with a new key version
```

## Scripts

| Script          | Description                              |
| --------------- | ---------------------------------------- |
| `bun run dev`   | Start API with watch mode                |
| `bun start`     | Start API                                |
| `bun test`      | Run unit + integration tests             |
| `bun run e2e:lfs` | End-to-end LFS flow against local MinIO |

## API Endpoints

All responses follow `{ data }` for success and `{ error: { code, message } }` for errors. Web routes require a session cookie; git and LFS routes require a token (Basic auth).

### Auth

| Method | Path                          | Description                         |
| ------ | ----------------------------- | ----------------------------------- |
| GET    | `/auth/bootstrap`             | Check if setup is needed            |
| POST   | `/auth/login`                 | Login (sets session cookie)         |
| POST   | `/auth/logout`                | Logout                              |
| GET    | `/auth/me`                    | Current user                        |
| POST   | `/auth/revoke-all`            | Revoke all sessions                 |
| POST   | `/auth/change-password`       | Change password                     |

### Tokens

| Method | Path            | Description               |
| ------ | --------------- | ------------------------- |
| GET    | `/tokens`       | List tokens               |
| POST   | `/tokens`       | Create a token (shown once) |
| DELETE | `/tokens/:id`   | Revoke a token            |

### Storage Connections

| Method | Path                              | Description                  |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/storage/connections`            | List connections             |
| POST   | `/storage/connections`            | Create a connection          |
| GET    | `/storage/connections/:id`        | Connection detail            |
| PATCH  | `/storage/connections/:id`        | Update connection            |
| DELETE | `/storage/connections/:id`        | Delete connection            |
| POST   | `/storage/connections/:id/test`   | Test the connection          |
| GET    | `/storage/connections/:id/objects?prefix=` | List objects        |
| GET    | `/storage/connections/:id/objects/:key` | Download object      |
| POST   | `/storage/connections/:id/objects/:key` | Upload object        |
| DELETE | `/storage/connections/:id/objects/:key` | Delete object        |

### Projects

| Method | Path                          | Description                 |
| ------ | ----------------------------- | --------------------------- |
| GET    | `/projects`                   | List projects               |
| POST   | `/projects`                   | Create project (inits a bare repo) |
| GET    | `/projects/:id`               | Project detail              |
| PATCH  | `/projects/:id`               | Update project              |
| DELETE | `/projects/:id`               | Delete project              |
| GET    | `/projects/:id/history`       | Commit history              |
| GET    | `/projects/:id/history/:hash/diff` | Commit diff            |

### Git Smart HTTP + LFS (token auth, public git protocol)

| Method | Path                                             | Description                    |
| ------ | ------------------------------------------------ | ------------------------------ |
| GET    | `/projects/<name>.git/info/refs?service=...`     | Git ref advertisement          |
| POST   | `/projects/<name>.git/git-upload-pack`           | Git upload pack (pull/clone)   |
| POST   | `/projects/<name>.git/git-receive-pack`          | Git receive pack (push)        |
| POST   | `/projects/<name>.git/info/lfs/objects/batch`    | LFS batch operation            |
| PUT    | `/projects/<name>.git/info/lfs/objects/:oid`     | LFS upload content             |
| GET    | `/projects/<name>.git/info/lfs/objects/:oid`     | LFS download content           |
| POST   | `/projects/<name>.git/info/lfs/objects/:oid/verify` | LFS verify                |

## Testing

```bash
bun test
```

Rules:

- Never run tests against the dev database. Create a dedicated test database (for example `sigit_test`) and point `DATABASE_URL` at it.
- The LFS integration test needs local MinIO (`http://127.0.0.1:9000`, `minioadmin`/`minioadmin`, bucket `sigit-test`, force path style). See `tests/projects.test.ts`.

## Project Structure

```
src/
├── index.ts          # Hono app entry point
├── config/           # env, S3 client factory, DB client
├── db/
│   ├── schema/       # Drizzle schema
│   └── migrations/   # auto-generated by drizzle-kit
├── middleware/       # auth, git token auth
├── modules/
│   ├── auth/         # sessions, password hashing
│   ├── git/          # smart HTTP handling, hooks
│   ├── lfs/          # LFS server (batch, verify, storage)
│   ├── projects/     # project metadata, bare repos, backup
│   └── storage/      # S3 connections, buckets, objects
└── routes/           # API routes (OpenAPI)
```
