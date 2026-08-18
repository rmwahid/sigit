# syntax=docker/dockerfile:1
# Single build file with one target per service. It lives at the repo root
# (build context ".") because the workspace lockfile (bun.lock) spans backend/
# and frontend/. Services select their image via `build.target`, which works on
# both Docker Compose and podman-compose 1.6.0 (the latter ignores the
# `dockerfile:` build key on Windows, where absolute contexts are misdetected
# as git URLs; podman auto-discovers this file from the context root instead).

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile

# --- target: backend ---
FROM deps AS backend-build
COPY backend/tsconfig.json backend/
COPY backend/src backend/src
WORKDIR /app/backend
RUN bun run build

# Runtime is Debian-based: Alpine's git (2.49) no longer ships git-http-backend,
# which the git smart HTTP handler spawns, so the backend needs Debian's git.
FROM oven/bun:1-slim AS backend
RUN apt-get update \
  && apt-get install -y --no-install-recommends git git-lfs ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r -g 10001 sigit && useradd -r -u 10001 -g 10001 sigit
WORKDIR /app
# backend/dist contains dist/, drizzle/ and package.json (deploy layout).
COPY --from=backend-build /app/backend/dist /app/
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data/projects /data/logs && chown -R sigit:sigit /data
VOLUME /data
ENV NODE_ENV=production \
  HOME=/tmp \
  SIGIT_PROJECTS_ROOT=/data/projects \
  LOG_DIR=/data/logs
USER sigit
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:3000/app-info'); process.exit(r.ok ? 0 : 1)"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "dist/index.js"]

# --- target: frontend ---
FROM deps AS frontend-build
COPY frontend frontend
WORKDIR /app/frontend
RUN bun run build

FROM caddy:2-alpine AS frontend
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /app/frontend/build /usr/share/caddy
EXPOSE 80 443
