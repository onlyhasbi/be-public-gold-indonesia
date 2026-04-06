import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { rateLimit } from "../middleware/rateLimit";
import { randomUUID } from "node:crypto";
import { getSetting, rotateSecretIfNeeded } from "../utils/settings";
import { createGoogleContact } from "../utils/google_utils";

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
      // Handle both JSON body (axios) and text/plain body (sendBeacon)
      let data: any;
      if (typeof body === "string") {
        try { data = JSON.parse(body); } catch { 
          set.status = 400;
          return { success: false, message: "Invalid body" };
        }
      } else {
        data = body;
      }

      const pageid = data?.pageid;
      const event = data?.event;
      if (!pageid || !event || typeof pageid !== "string" || typeof event !== "string") {
        set.status = 400;
        return { success: false, message: "Missing pageid or event" };
      }
      
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
      console.error("[Analytics Error]", error);
      set.status = 500;
      return { success: false, message: error.message };
    }
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
  })
  .post("/register-track", async ({ body, set }) => {
    try {
      const { pageid, nama, branch, no_telpon } = body;
      
      // Get agent internal ID based on pageid
      const agentRes = await db.execute({
        sql: `SELECT id FROM users WHERE role = 'pgbo' AND pageid = ? AND is_active = 1`,
        args: [pageid],
      });

      if (agentRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      const agentId = agentRes.rows[0].id as string;
      const id = randomUUID();

      await db.execute({
        sql: `INSERT INTO leads (id, user_id, nama, branch, no_telpon) VALUES (?, ?, ?, ?, ?)`,
        args: [id, agentId, nama, branch, no_telpon],
      });

      // Async sync to Google Contacts (if active)
      createGoogleContact(agentId, { nama, branch, no_telpon }).catch(err => {
        console.error("Delayed Google Sync Error:", err);
      });

      return { success: true, message: "Lead tracked successfully" };
    } catch (error: any) {
      console.error("[Register Track Error]", error);
      set.status = 500;
      return { success: false, message: error.message };
    }
  }, {
    body: t.Object({
      pageid: t.String(),
      nama: t.String(),
      branch: t.String(),
      no_telpon: t.String()
    })
  });
