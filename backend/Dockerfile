# syntax=docker/dockerfile:1
# Build context: repo root (workspace lockfile). The build stage only needs the
# source; the runtime image ships the self-contained dist/ bundle produced by
# `bun run build` (all npm dependencies bundled, no node_modules at runtime).
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile
COPY backend/tsconfig.json backend/
COPY backend/src backend/src
WORKDIR /app/backend
RUN bun run build

FROM oven/bun:1-alpine AS runtime
RUN apk add --no-cache git git-lfs ca-certificates tzdata \
  && addgroup -S sigit && adduser -S -G sigit sigit
WORKDIR /app
COPY --from=build /app/backend/dist ./dist
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
  CMD wget -qO- http://127.0.0.1:3000/app-info >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "dist/index.js"]
