import { Elysia, Context } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { overviewRoutes } from "./routes/overview";
import { settingsRoutes } from "./routes/settings";
import { publicRoutes } from "./routes/public";
import { setupDatabase } from "./db/db";
import { securityHeaders } from "./middleware/securityHeaders";
import { swagger } from "@elysiajs/swagger";

// Initialize database
try {
  await setupDatabase();
} catch (error) {
  console.error("Failed to initialize database:", error);
}

const api = new Elysia({ prefix: "/api" })
  .onAfterHandle(({ response, set }) => {
    if (response && typeof response === "object" && !Array.isArray(response)) {
      const stringified = JSON.stringify(response);
      if (stringified.length > 1024) {
        set.headers["Content-Encoding"] = "gzip";
        return new Response(Bun.gzipSync(Buffer.from(stringified)), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  })
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
  .use(securityHeaders)
  .onError(({ code, set, error }) => {
    console.error(`Error [${code}]:`, error);

    // Ensure CORS headers are present even on error responses
    set.headers["Access-Control-Allow-Origin"] = "*";
    set.headers["Access-Control-Allow-Methods"] =
      "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    set.headers["Access-Control-Allow-Headers"] = "*";

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
  .get("/", (c: Context) => c.redirect("/api/docs"));

const app = new Elysia()
  .use(
    cors({
      origin: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Accept"],
      credentials: true,
    }),
  )
  .onBeforeHandle(({ set }) => {
    // Explicitly handle OPTIONS preflight if needed
    set.headers["Access-Control-Allow-Methods"] =
      "GET, POST, PUT, PATCH, DELETE, OPTIONS";
  })
  .use(api)
  .use(publicRoutes)
  .get("/", (c: Context) => c.redirect("/api/docs"));

if (import.meta.main || !process.env.VERCEL) {
  const port = process.env.PORT || 3001;
  app.listen(port);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
  );
}

export default app;
