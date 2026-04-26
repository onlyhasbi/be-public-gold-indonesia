import { Elysia, t } from "elysia";
import { randomUUID } from "node:crypto";
import { db } from "../db/db";
import { rateLimit } from "../middleware/rateLimit";
import { getSetting, rotateSecretIfNeeded } from "../utils/settings";

import { fetchGoldPrices } from "../services/goldPriceService";

// Helper to match frontend Cloudinary optimization logic
const optimizeImageUrl = (
  url: string | null | undefined,
  width = 400,
): string => {
  if (!url) return "";
  if (
    url.includes("res.cloudinary.com") ||
    url.startsWith("/") ||
    url.startsWith(".")
  )
    return url;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "dvq5fmqpp";
  const transformations = `f_auto,q_auto,w_${width},c_limit`;

  return `https://res.cloudinary.com/${cloudName}/image/fetch/${transformations}/${encodeURIComponent(url)}`;
};

export const publicRoutes = new Elysia({
  prefix: "/public",
  detail: { tags: ["Public"] },
})
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
    } catch (error) {
      console.error("[PGBO Endpoint Error]:", error);
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .get("/agents", async ({ set }) => {
    try {
      const result = await db.execute({
        sql: `SELECT pageid, nama_panggilan, foto_profil_url FROM users WHERE role = 'pgbo' AND is_active = 1`,
        args: [],
      });

      return {
        success: true,
        data: result.rows.map((row) => ({
          pageid: row.pageid,
          nama_panggilan: row.nama_panggilan,
          foto_profil_url: row.foto_profil_url,
        })),
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .get("/gold-prices", async ({ set }) => {
    try {
      const data = await fetchGoldPrices();

      if (!data) {
        set.status = 500;
        return { success: false, message: "Gagal mengambil data harga emas" };
      }

      // Cache gold prices for 2 minutes at edge
      set.headers["Cache-Control"] = "public, max-age=120, s-maxage=120";

      return {
        success: true,
        data,
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .get("/random", async ({ set }) => {
    try {
      const result = await db.execute({
        sql: `
          SELECT 
            nama_lengkap, nama_panggilan, pageid, foto_profil_url, no_telpon
          FROM users 
          WHERE role = 'pgbo' AND is_active = 1
          ORDER BY RANDOM()
          LIMIT 1
        `,
        args: [],
      });

      if (result.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "No active PGBO found" };
      }

      return {
        success: true,
        data: result.rows[0],
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .post("/analytics", async ({ body, set }) => {
    try {
      // Handle both JSON body (axios) and text/plain body (sendBeacon)
      let data: { pageid?: string; event?: string } | null = null;
      if (typeof body === "string") {
        try {
          data = JSON.parse(body);
        } catch {
          set.status = 400;
          return { success: false, message: "Invalid body" };
        }
      } else {
        data = body as { pageid?: string; event?: string };
      }

      const { pageid, event } = data || {};
      if (!pageid || !event) {
        set.status = 400;
        return { success: false, message: "Missing pageid or event" };
      }

      // Get agent internal ID (using index on pageid)
      const agentRes = await db.execute({
        sql: `SELECT id FROM users WHERE pageid = ? AND is_active = 1 LIMIT 1`,
        args: [pageid],
      });

      if (agentRes.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      const agentId = String(agentRes.rows[0].id);
      const id = randomUUID();

      await db.execute({
        sql: `INSERT INTO analytics (id, user_id, event_type) VALUES (?, ?, ?)`,
        args: [id, agentId, event],
      });

      return { success: true };
    } catch (error) {
      console.error("[Analytics Error]", error);
      set.status = 500;
      const msg = error instanceof Error ? error.message : "Terjadi kesalahan";
      return { success: false, message: msg };
    }
  })
  .use(rateLimit({ max: 5, windowMs: 60 * 1000 }))
  .post(
    "/portal/verify",
    async ({ body, set }) => {
      try {
        await rotateSecretIfNeeded();

        const { code } = body;

        // Ultra-robust normalization: keep ONLY letters and numbers
        const normalize = (s: string) =>
          s.toLowerCase().replace(/[^a-z0-9]/g, "");

        const rawSecret = await getSetting("portal_secret_code");

        const normalizedInput = normalize(code ?? "");
        const normalizedSecret = normalize(rawSecret ?? "");

        if (normalizedInput === normalizedSecret) {
          return { success: true };
        } else {
          set.status = 401;
          return { success: false, message: "Kode rahasia tidak valid" };
        }
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Terjadi kesalahan pada server" };
      }
    },
    {
      body: t.Object({
        code: t.String(),
      }),
    },
  )
  .post(
    "/register-track",
    async ({ body, set }) => {
      try {
        const { pageid, nama, branch, no_telpon } = body;

        // Get agent internal ID (indexed lookup)
        const agentRes = await db.execute({
          sql: `SELECT id FROM users WHERE pageid = ? AND is_active = 1 LIMIT 1`,
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

        return { success: true, message: "Lead tracked successfully" };
      } catch (error) {
        console.error("[Register Track Error]", error);
        set.status = 500;
        const msg =
          error instanceof Error ? error.message : "Terjadi kesalahan";
        return { success: false, message: msg };
      }
    },
    {
      body: t.Object({
        pageid: t.String(),
        nama: t.String(),
        branch: t.String(),
        no_telpon: t.String(),
      }),
    },
  );
