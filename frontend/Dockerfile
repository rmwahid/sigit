# syntax=docker/dockerfile:1
# Build context: repo root (workspace lockfile). The build stage emits the
# static SPA (adapter-static); the runtime is Caddy serving those files plus
# the /api reverse proxy, so no Node runtime is shipped at all.
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN bun install --frozen-lockfile
COPY frontend frontend
WORKDIR /app/frontend
RUN bun run build

FROM caddy:2-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/build /usr/share/caddy
EXPOSE 80 443
