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

const app = new Elysia()
  .use(cors({
    origin: (process.env.CORS_ORIGIN === "*" || !process.env.CORS_ORIGIN)
      ? true
      : process.env.CORS_ORIGIN.split(",").map(o => o.trim()),
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
      "Origin",
      "Referer",
      "Accept-Language"
    ],
    credentials: true
  }))
  .use(swagger({
    documentation: {
      info: {
        title: "Public Gold Indonesia API",
        version: "1.0.0",
        description: "Dokumentasi API untuk PGBO Portal Management",
      },
    },
  }))
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
  .use(authRoutes)
  .use(adminRoutes)
  .use(overviewRoutes)
  .use(settingsRoutes)
  .use(publicRoutes)
  .get("/", () => ({
    status: "online",
    message: "Hasbi-PG Elysia API is running!",
    timestamp: new Date().toISOString()
  }));

// For local development
if (import.meta.main || !process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port);
  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
}

export default app;
