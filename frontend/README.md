# SiGit UI

SvelteKit frontend for [SiGit](..): project dashboard, commit history, diff viewer, and token management.

## Prerequisites

- [Bun](https://bun.sh)
- The [SiGit API](../backend) running on `http://localhost:3000`

## Setup

```bash
bun install
cp .env.example .env
bun run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api` to the backend at `http://localhost:3000`.

## Environment Variables

| Variable           | Default                   | Description                          |
| ------------------ | ------------------------- | ------------------------------------ |
| `PUBLIC_API_URL`   | `http://localhost:3000`   | Backend API base URL                 |

## Scripts

| Script         | Description                     |
| -------------- | ------------------------------- |
| `bun run dev`  | Start dev server                |
| `bun run build`| Production build                |
| `bun run preview` | Preview the production build |
| `bun test`     | Run unit tests (vitest)         |

## Project Structure

```
src/
├── routes/     # SvelteKit routes (setup, login, dashboard, projects, settings)
└── lib/        # API client, shared components (LogViewer, diff rendering)
```
