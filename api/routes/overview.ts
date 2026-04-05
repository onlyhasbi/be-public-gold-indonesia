import { Elysia } from "elysia";
import { db } from "../db/db";
import { jwt } from "@elysiajs/jwt";
import { rateLimit } from "../middleware/rateLimit";

export const overviewRoutes = new Elysia({ prefix: "/overview" })
  .use(
    jwt({
      name: "jwt",
      secret: Bun.env.JWT_SECRET || "REDACTED_JWT_SECRET",
    })
  )
  // Rate limit: 60 requests per minute
  .use(rateLimit({ max: 60, windowMs: 60 * 1000 }))
  .derive(async ({ headers, jwt, set }) => {
    const auth = headers["authorization"];
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      set.status = 401;
      return { user: null as any, unauthorized: true };
    }
    const payload = await jwt.verify(token);
    if (!payload) {
      set.status = 401;
      return { user: null as any, unauthorized: true };
    }
    return { user: payload, unauthorized: false };
  })
  .onBeforeHandle(({ unauthorized, set }) => {
    if (unauthorized) {
      set.status = 401;
      return { success: false, message: "Akses ditolak" };
    }
  })
  .get("/", async ({ user, set }) => {
    try {
      const pgcode = user.sub;

      // Lookup agent by pgcode to get the internal id for FK queries
      const agentRes = await db.execute({
        sql: `SELECT id FROM users WHERE pgcode = ?`,
        args: [pgcode],
      });

      if (agentRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      const agentId = agentRes.rows[0].id;

      // Get stats using agent internal id (parameterized — safe from SQL injection)
      const visitorCountRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM analytics WHERE user_id = ? AND event_type = 'visitor'`,
        args: [agentId],
      });
      const whatsappCountRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM analytics WHERE user_id = ? AND event_type = 'whatsapp_click'`,
        args: [agentId],
      });
      const leadsCountRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM leads WHERE user_id = ?`,
        args: [agentId],
      });

      // Get top 10 latest registrants
      const leadsRes = await db.execute({
        sql: `SELECT nama, branch, no_telpon, created_at FROM leads WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        args: [agentId],
      });

      return {
        success: true,
        data: {
          total_pengunjung: visitorCountRes.rows[0].count,
          total_klik_whatsapp: whatsappCountRes.rows[0].count,
          total_pendaftar: leadsCountRes.rows[0].count,
          tabel_pendaftar_terbaru: leadsRes.rows,
        },
      };
    } catch (error: any) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  });
