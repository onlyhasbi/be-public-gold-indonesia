import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { overviewRoutes } from "./routes/overview";
import { settingsRoutes } from "./routes/settings";
import { publicRoutes } from "./routes/public";
import { setupDatabase } from "./db/db";
import { securityHeaders } from "./middleware/securityHeaders";

// Initialize database
await setupDatabase();

const app = new Elysia()
  // CORS — restrict origins in production
  .use(cors({ origin: Bun.env.CORS_ORIGIN || "*" }))
  // Security headers (XSS, clickjacking, MIME sniffing protection)
  .use(securityHeaders)
  // Global error handler — never leak internal errors to clients
  .onError(({ code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { success: false, message: "Data yang dikirim tidak valid" };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { success: false, message: "Endpoint tidak ditemukan" };
    }
    // For rate limit (thrown as Error)
    set.status = 500;
    return { success: false, message: "Terjadi kesalahan pada server" };
  })
  .use(authRoutes)
  .use(adminRoutes)
  .use(overviewRoutes)
  .use(settingsRoutes)
  .use(publicRoutes)
  .get("/", () => "Hasbi-PG Elysia API is running!")
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
