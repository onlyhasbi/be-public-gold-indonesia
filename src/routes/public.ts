import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { rateLimit } from "../middleware/rateLimit";
import { randomUUID } from "node:crypto";
import { getSetting, rotateSecretIfNeeded } from "../utils/settings";
import type { UserRow } from "../types/db";

import { renderHtmlWithMeta } from "../utils/seo";
import { fetchGoldPrices } from "../services/goldPriceService";

// Helper to match frontend Cloudinary optimization logic
const optimizeImageUrl = (url: string | null | undefined, width = 600): string => {
  if (!url) return "";
  if (url.includes("res.cloudinary.com") || url.startsWith("/") || url.startsWith(".")) return url;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const transformations = `f_auto,q_auto,c_limit,w_${width}`;

  return `https://res.cloudinary.com/${cloudName}/image/fetch/${transformations}/${encodeURIComponent(url)}`;
};

export const publicRoutes = new Elysia({
  prefix: "/public",
  detail: { tags: ["Public"] },
})
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

      return {
        success: true,
        data,
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .get("/sitemap.xml", async ({ set }) => {
    try {
      const result = await db.execute({
        sql: `SELECT pageid FROM users WHERE role = 'pgbo' AND is_active = 1`,
        args: [],
      });

      const pages = result.rows;
      const baseUrl = Bun.env.FRONTEND_URL || "https://mypublicgold.id";

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

      pages.forEach((row) => {
        const u = row as unknown as { pageid: string };
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/${u.pageid}</loc>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      });

      xml += `</urlset>`;

      set.headers["Content-Type"] = "application/xml";
      return xml;
    } catch (error) {
      set.status = 500;
      return "Error generating sitemap";
    }
  })
  .get("/render/:pageid", async ({ params, set }) => {
    try {
      const pageid = params.pageid;

      const result = await db.execute({
        sql: `SELECT nama_lengkap, pageid, foto_profil_url FROM users WHERE pageid = ? AND is_active = 1`,
        args: [pageid],
      });

      if (result.rows.length === 0) {
        set.status = 404;
        return "Not Found";
      }

      const user = result.rows[0];
      const profilePhoto = user.foto_profil_url as string;
      const optimizedPhoto = optimizeImageUrl(profilePhoto, 600);

      const html = await renderHtmlWithMeta({
        url: `/${pageid}`,
        title: `${user.nama_lengkap}-Konsultan Emas Public Gold Indonesia`,
        description: `Amankan masa depan keluarga dengan tabungan emas bersama Public Gold Indonesia. Daftar gratis sekarang`,
        image: profilePhoto,
        preloadImages: optimizedPhoto ? [optimizedPhoto] : [],
        preloadApis: [`/public/pgbo/${pageid}`, "/public/gold-prices"],
      });

      set.headers["Content-Type"] = "text/html";
      return html;
    } catch (error) {
      set.status = 500;
      return "Internal Server Error";
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
