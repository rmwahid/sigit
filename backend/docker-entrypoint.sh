#!/bin/sh
set -e

# Wait for postgres and bring the schema up to date. migrate.js is the bundled
# drizzle-compatible runner and is idempotent, so this mirrors Gitea's
# migrate-on-boot behavior on every container start. Only connection failures
# are retried; anything else fails fast so real errors are not masked.
echo "[entrypoint] waiting for postgres..."
attempt=0
while :; do
  if output=$(bun dist/migrate.js 2>&1); then
    echo "$output"
    break
  fi
  attempt=$((attempt + 1))
  if ! printf '%s' "$output" | grep -qiE "connect|ECONNREFUSED|terminated unexpectedly|getaddrinfo|Connection refused"; then
    echo "$output" >&2
    echo "[entrypoint] migration failed for a non-connection reason" >&2
    exit 1
  fi
  if [ "$attempt" -ge 60 ]; then
    echo "[entrypoint] database still not ready after 2 minutes" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "[entrypoint] postgres not ready (attempt $attempt), retrying in 2s..."
  sleep 2
done

# Optional first-run admin bootstrap. No-op when an admin already exists or
# when the variables are not set (admin can be created manually via exec).
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "[entrypoint] bootstrapping admin user..."
  if ! bun dist/create-admin.js --non-interactive; then
    echo "[entrypoint] WARNING: admin bootstrap failed, see above" >&2
  fi
fi

echo "[entrypoint] starting SiGit"
exec "$@"
