import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { overviewRoutes } from "./routes/overview";
import { settingsRoutes } from "./routes/settings";
import { publicRoutes } from "./routes/public";
import { setupDatabase } from "./db/db";
import { securityHeaders } from "./middleware/securityHeaders";
import { swagger } from "@elysiajs/swagger";

// Initialize database with basic error handling to prevent startup crashes
try {
  await setupDatabase();
} catch (error) {
  console.error("Failed to initialize database:", error);
}

const api = new Elysia({ prefix: "/api" })
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get("origin");
        if (!origin) return false;

        // Parse allowed origins from environment variable (comma-separated)
        const corsOriginEnv = Bun.env.CORS_ORIGIN || "http://localhost:5173";
        const allowedOrigins = corsOriginEnv.split(",").map((o) => o.trim());

        // Also include FRONTEND_URL if set separately
        const frontendUrl = Bun.env.FRONTEND_URL;
        if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
          allowedOrigins.push(frontendUrl);
          // Automatically add www version for production convenience
          if (
            frontendUrl.startsWith("https://") &&
            !frontendUrl.includes("www.")
          ) {
            allowedOrigins.push(
              frontendUrl.replace("https://", "https://www."),
            );
          }
        }

        // Direct match
        if (allowedOrigins.includes(origin)) return true;

        // Dynamic allowance for Vercel preview deployments
        if (/^https:\/\/.*-onlyhasbi\.vercel\.app$/.test(origin)) return true;

        return false;
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  )
  .use(
    swagger({
      documentation: {
        info: {
          title: "Public Gold Indonesia API",
          version: "1.0.0",
          description: "Dokumentasi API untuk PGBO Portal Management",
        },
      },
      path: "/docs",
    }),
  )
  // Security headers (XSS, clickjacking, MIME sniffing protection)
  .use(securityHeaders)
  // Global error handler — never leak internal errors to clients
  .onError(({ code, set, error }) => {
    console.error(`Error [${code}]:`, error);

    if (code === "VALIDATION") {
      set.status = 400;
      return { success: false, message: "Data yang dikirim tidak valid" };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { success: false, message: "Endpoint tidak ditemukan" };
    }

    set.status = 500;
    return { success: false, message: "Terjadi kesalahan pada server" };
  })
  .group("", (app) => app.use(authRoutes))
  .group("", (app) => app.use(adminRoutes))
  .group("", (app) => app.use(overviewRoutes))
  .group("", (app) => app.use(settingsRoutes))
  .group("", (app) => app.use(publicRoutes))
  .get("/", ({ redirect }) => redirect("/api/docs"));

// Root app to catch the absolute base path "/"
const app = new Elysia()
  .use(api)
  .get("/", ({ redirect }) => redirect("/api/docs"));

// For local development
if (import.meta.main || !process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
  );
}

export default app;
