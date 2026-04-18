import { Elysia } from "elysia";

/**
 * Security headers middleware.
 * Adds HTTP headers to protect against common web vulnerabilities:
 * - XSS, clickjacking, MIME-type sniffing, referrer leaks, etc.
 */
export const securityHeaders = new Elysia({
  name: "security-headers",
}).onAfterHandle(({ set }) => {
  // Prevent MIME-type sniffing
  set.headers["X-Content-Type-Options"] = "nosniff";

  // Prevent clickjacking via iframe embedding
  set.headers["X-Frame-Options"] = "DENY";

  // Enable XSS filter in older browsers
  set.headers["X-XSS-Protection"] = "1; mode=block";

  // Control referrer information leakage
  set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

  // Restrict browser features/APIs the app can access
  set.headers["Permissions-Policy"] =
    "camera=(), microphone=(), geolocation=()";

  // Prevent caching of API responses that may contain sensitive data
  set.headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
  set.headers["Pragma"] = "no-cache";
});
