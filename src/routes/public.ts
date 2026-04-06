import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { rateLimit } from "../middleware/rateLimit";
import { randomUUID } from "node:crypto";
import { getSetting, rotateSecretIfNeeded } from "../utils/settings";

export const publicRoutes = new Elysia({ prefix: "/public" })
  .use(rateLimit({ max: 60, windowMs: 60 * 1000 })) // 60 requests per minute
  .get("/pgbo/:pageid", async ({ params, set }) => {
    try {
      const pageid = params.pageid;

      const result = await db.execute({
        sql: `
          SELECT 
            pgcode, pageid, nama_lengkap, nama_panggilan, email, 
            no_telpon, link_group_whatsapp, 
            sosmed_facebook, sosmed_instagram, sosmed_tiktok, 
            foto_profil_url 
          FROM users 
          WHERE role = 'pgbo' AND pageid = ? AND is_active = 1
        `,
        args: [pageid],
      });

      if (result.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Page ID tidak ditemukan" };
      }

      return {
        success: true,
        data: result.rows[0],
      };
    } catch (error: any) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .post("/analytics", async ({ body, set }) => {
    try {
      const { pageid, event } = body;
      
      // Get agent internal ID based on pageid
      const agentRes = await db.execute({
        sql: `SELECT id FROM users WHERE role = 'pgbo' AND pageid = ? AND is_active = 1`,
        args: [pageid],
      });

      if (agentRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      const agentId = agentRes.rows[0].id;
      const id = randomUUID();

      await db.execute({
        sql: `INSERT INTO analytics (id, user_id, event_type) VALUES (?, ?, ?)`,
        args: [id, agentId, event],
      });

      return { success: true };
    } catch (error: any) {
      set.status = 500;
      return { success: false, message: "Server error" };
    }
  }, {
    body: t.Object({
      pageid: t.String(),
      event: t.String()
    })
  })
  .post("/portal/verify", async ({ body, set }) => {
    try {
      await rotateSecretIfNeeded();
      
      const { code } = body;
      const secretCode = await getSetting("portal_secret_code");
      
      if (!secretCode) {
        set.status = 500;
        return { success: false, message: "System configuration error" };
      }
      
      const normalizedInput = code?.toLowerCase().trim();
      const normalizedSecret = secretCode.toLowerCase().trim();
      
      if (normalizedInput === normalizedSecret) {
        return { success: true };
      } else {
        set.status = 401;
        return { success: false, message: "Kode rahasia tidak valid" };
      }
    } catch (error: any) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  }, {
    body: t.Object({
      code: t.String()
    })
  });
