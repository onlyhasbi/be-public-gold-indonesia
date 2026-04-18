import { Elysia } from "elysia";

/**
 * In-memory rate limiter middleware.
 * Tracks request counts per IP within a rolling window.
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60 seconds to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 60_000);

interface RateLimitOptions {
  /** Max requests allowed within the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export const rateLimit = ({ max, windowMs }: RateLimitOptions) => {
  return new Elysia({ name: `rate-limit-${max}-${windowMs}` }).derive(
    ({ set, request }) => {
      // Extract client IP from headers or fallback
      const forwarded = request.headers.get("x-forwarded-for");
      const ip = forwarded?.split(",")[0]?.trim() || "unknown";
      const key = `${ip}:${new URL(request.url).pathname}`;
      const now = Date.now();

      let entry = store.get(key);

      if (!entry || now > entry.resetTime) {
        entry = { count: 1, resetTime: now + windowMs };
        store.set(key, entry);
      } else {
        entry.count++;
      }

      // Set rate limit headers
      set.headers["X-RateLimit-Limit"] = String(max);
      set.headers["X-RateLimit-Remaining"] = String(
        Math.max(0, max - entry.count),
      );
      set.headers["X-RateLimit-Reset"] = String(
        Math.ceil(entry.resetTime / 1000),
      );

      if (entry.count > max) {
        set.status = 429;
        throw new Error("Too many requests");
      }

      return {};
    },
  );
};
