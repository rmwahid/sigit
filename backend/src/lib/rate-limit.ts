// In-memory rate limiter for the unauthenticated credential surfaces (login,
// invite accept, password verification) and the git token Basic-auth path.
// Process-local by design: a single SiGit instance is the deployment model
// (compose runs one backend), and the ring-buffer logger already accepts
// in-memory state for observability. Fixed window counters keep it tiny and
// allocation-free per request.
import { RATE_LIMIT_WINDOW_MS } from "@/constants/limits";

export type RateLimitRule = {
  // Distinct bucket name, e.g. "auth.login".
  name: string;
  // Max attempts allowed per window.
  max: number;
  // Optional per-rule window override (defaults to RATE_LIMIT_WINDOW_MS).
  windowMs?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  // Seconds until the window resets (0 when allowed).
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

// Counters are keyed by rule + identity so one client cannot exhaust another's
// budget, and empty buckets are evicted on access rather than by a timer.
const buckets = new Map<string, Bucket>();

function ruleKey(rule: RateLimitRule, identity: string): string {
  return `${rule.name}|${identity}`;
}

// Records one attempt and returns whether it is allowed.
export function consumeRateLimit(rule: RateLimitRule, identity: string, now = Date.now()): RateLimitResult {
  const windowMs = rule.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const key = ruleKey(rule, identity);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > rule.max) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// Clears the counter for an identity (called after a successful login so a
// legitimate user who mistyped a few times is not left throttled).
export function resetRateLimit(rule: RateLimitRule, identity: string): void {
  buckets.delete(ruleKey(rule, identity));
}

// Test/ops helper: drop every bucket.
export function resetAllRateLimits(): void {
  buckets.clear();
}

// Number of tracked buckets (used by tests to assert eviction/reuse).
export function rateLimitBucketCount(): number {
  return buckets.size;
}

// Client identity for rate limiting: the forwarded client address when a
// reverse proxy (Caddy) supplies one, else the direct connection address. The
// value is only ever a bucket key, never a security decision on its own.
export function clientIdentity(headers: Headers, fallback = "unknown"): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return fallback;
}
