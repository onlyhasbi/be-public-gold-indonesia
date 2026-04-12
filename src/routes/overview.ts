import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { jwt } from "@elysiajs/jwt";
import { rateLimit } from "../middleware/rateLimit";
import { createGoogleContact } from "../utils/google_utils";

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
        sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
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

      // Get ALL registrants (no limit) with id and exported_at
      const leadsRes = await db.execute({
        sql: `SELECT id, nama, branch, no_telpon, exported_at, created_at FROM leads WHERE user_id = ? ORDER BY created_at DESC`,
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
  })
  .post("/leads/sync-contacts", async ({ body, user, set }) => {
    try {
      const { ids } = body;
      if (!ids || ids.length === 0) {
        set.status = 400;
        return { success: false, message: "Tidak ada kontak yang dipilih" };
      }

      const pgcode = user.sub;

      // Get agent id
      const agentRes = await db.execute({
        sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
        args: [pgcode],
      });

      if (agentRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      const agentId = agentRes.rows[0].id as string;

      // Check if Google is connected
      const userRes = await db.execute({
        sql: `SELECT google_refresh_token FROM users WHERE id = ?`,
        args: [agentId],
      });

      if (!userRes.rows[0]?.google_refresh_token) {
        set.status = 400;
        return { success: false, message: "Akun Google belum terhubung. Silakan hubungkan di halaman Pengaturan." };
      }

      // Fetch leads data for the given ids
      const placeholders = ids.map(() => "?").join(", ");
      const leadsRes = await db.execute({
        sql: `SELECT id, nama, branch, no_telpon FROM leads WHERE user_id = ? AND id IN (${placeholders})`,
        args: [agentId, ...ids],
      });

      if (leadsRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Tidak ada data pendaftar yang ditemukan" };
      }

      // Sync each contact to Google
      let syncedCount = 0;
      const errors: string[] = [];

      for (const lead of leadsRes.rows) {
        try {
          await createGoogleContact(agentId, {
            nama: lead.nama as string,
            branch: lead.branch as string,
            no_telpon: lead.no_telpon as string,
          });

          // Mark as exported
          await db.execute({
            sql: `UPDATE leads SET exported_at = CURRENT_TIMESTAMP WHERE id = ?`,
            args: [lead.id],
          });

          syncedCount++;
        } catch (err: any) {
          errors.push(`${lead.nama}: ${err.message}`);
        }
      }

      return {
        success: true,
        message: `${syncedCount} kontak berhasil disinkronkan ke Google Contacts`,
        data: { synced: syncedCount, failed: errors.length, errors },
      };
    } catch (error: any) {
      console.error("### SYNC CONTACTS ERROR:", error);
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan saat sinkronisasi kontak" };
    }
  }, {
    body: t.Object({
      ids: t.Array(t.String())
    })
  })
  .delete("/leads/:id", async ({ params, user, set }) => {
    try {
      const pgcode = user.sub;
      const agentRes = await db.execute({
        sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
        args: [pgcode],
      });

      if (agentRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      const agentId = agentRes.rows[0].id as string;

      const result = await db.execute({
        sql: `DELETE FROM leads WHERE id = ? AND user_id = ?`,
        args: [params.id, agentId],
      });

      if (result.rowsAffected === 0) {
        set.status = 404;
        return { success: false, message: "Data pendaftar tidak ditemukan" };
      }

      return { success: true, message: "Pendaftar berhasil dihapus" };
    } catch (error: any) {
      console.error("### DELETE LEAD ERROR:", error);
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan saat menghapus data" };
    }
  });
