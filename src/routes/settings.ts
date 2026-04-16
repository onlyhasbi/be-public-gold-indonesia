import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { jwt } from "@elysiajs/jwt";
import cloudinary from "../config/cloudinary";
import { rateLimit } from "../middleware/rateLimit";
import {
  sanitizeString,
  isValidEmail,
  isValidUrl,
  validateImageFile,
} from "../utils/sanitize";
import { processImage } from "../utils/imageProcessor";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  .use(
    jwt({
      name: "jwt",
      secret: Bun.env.JWT_SECRET || "REDACTED_JWT_SECRET",
    })
  )
  // General rate limit: 30 requests per minute
  .use(rateLimit({ max: 30, windowMs: 60 * 1000 }))
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

      const res = await db.execute({
        sql: `SELECT pgcode, pageid, foto_profil_url, nama_lengkap, nama_panggilan, email, no_telpon, link_group_whatsapp, sosmed_facebook, sosmed_instagram, sosmed_tiktok FROM users WHERE UPPER(pgcode) = UPPER(?)`,
        args: [pgcode],
      });

      if (res.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      return { success: true, data: res.rows[0] };
    } catch (error: any) {
      set.status = 500;
      return { success: false, message: "Server error" };
    }
  })
  .put(
    "/",
    async ({ user, body, set }) => {
      try {
        const pgcode = user.sub;

        let photoUrl = body.foto_profil_url;

        // Validate, compress, convert to WebP, then upload
        if (body.foto_profil instanceof File) {
          const validation = validateImageFile(body.foto_profil);
          if (!validation.valid) {
            set.status = 400;
            return { success: false, message: validation.error };
          }

          // Compress + convert to WebP using sharp
          const processed = await processImage(body.foto_profil);
          const base64Str = processed.buffer.toString("base64");
          const dataUri = `data:${processed.mimeType};base64,${base64Str}`;

          // Upload optimized WebP to Cloudinary
          const uploadRes = await cloudinary.uploader.upload(dataUri, {
            folder: "profile_pictures",
            format: "webp",
          });

          photoUrl = uploadRes.secure_url;
        }

        // Sanitize all text inputs
        const namaLengkap = body.nama_lengkap
          ? sanitizeString(body.nama_lengkap)
          : null;
        const namaPanggilan = body.nama_panggilan
          ? sanitizeString(body.nama_panggilan)
          : null;
        const email = body.email ? sanitizeString(body.email) : null;
        const noTelpon = body.no_telpon
          ? sanitizeString(body.no_telpon)
          : null;
        const linkWa = body.link_group_whatsapp
          ? sanitizeString(body.link_group_whatsapp)
          : null;
        const facebook = body.sosmed_facebook
          ? sanitizeString(body.sosmed_facebook)
          : null;
        const instagram = body.sosmed_instagram
          ? sanitizeString(body.sosmed_instagram)
          : null;
        const tiktok = body.sosmed_tiktok
          ? sanitizeString(body.sosmed_tiktok)
          : null;

        // Validate email format if provided
        if (email && !isValidEmail(email)) {
          set.status = 400;
          return { success: false, message: "Format email tidak valid" };
        }

        // Validate URL formats if provided
        if (linkWa && !isValidUrl(linkWa)) {
          set.status = 400;
          return {
            success: false,
            message: "Format link WhatsApp tidak valid",
          };
        }

        // Update DB — identify agent by pgcode (parameterized query)
        await db.execute({
          sql: `
            UPDATE users SET 
              foto_profil_url = COALESCE(?, foto_profil_url),
              nama_lengkap = COALESCE(?, nama_lengkap),
              nama_panggilan = COALESCE(?, nama_panggilan),
              email = COALESCE(?, email),
              no_telpon = COALESCE(?, no_telpon),
              link_group_whatsapp = COALESCE(?, link_group_whatsapp),
              sosmed_facebook = COALESCE(?, sosmed_facebook),
              sosmed_instagram = COALESCE(?, sosmed_instagram),
              sosmed_tiktok = COALESCE(?, sosmed_tiktok)
            WHERE UPPER(pgcode) = UPPER(?)
          `,
          args: [
            photoUrl || null,
            namaLengkap,
            namaPanggilan,
            email,
            noTelpon,
            linkWa,
            facebook,
            instagram,
            tiktok,
            pgcode,
          ],
        });

        // Re-query updated data for client-side localStorage sync
        const updatedRes = await db.execute({
          sql: `SELECT pgcode, pageid, foto_profil_url, nama_lengkap, nama_panggilan, email, no_telpon, link_group_whatsapp, sosmed_facebook, sosmed_instagram, sosmed_tiktok FROM users WHERE UPPER(pgcode) = UPPER(?)`,
          args: [pgcode],
        });

        return {
          success: true,
          message: "Profil berhasil diperbarui",
          data: updatedRes.rows[0],
        };
      } catch (error: any) {
        set.status = 500;
        return { success: false, message: "Server error" };
      }
    },
    {
      body: t.Object({
        foto_profil: t.Optional(t.File({ maxSize: "2m" })),
        foto_profil_url: t.Optional(t.String()),
        nama_lengkap: t.Optional(t.String({ maxLength: 100 })),
        nama_panggilan: t.Optional(t.String({ maxLength: 50 })),
        email: t.Optional(t.String({ maxLength: 100 })),
        no_telpon: t.Optional(t.String({ maxLength: 20 })),
        link_group_whatsapp: t.Optional(t.String({ maxLength: 500 })),
        sosmed_facebook: t.Optional(t.String({ maxLength: 500 })),
        sosmed_instagram: t.Optional(t.String({ maxLength: 500 })),
        sosmed_tiktok: t.Optional(t.String({ maxLength: 500 })),
      }),
    }
  )
  .patch(
    "/password",
    async ({ user, body, set }) => {
      try {
        const pgcode = user.sub;
        const { katasandi_lama, katasandi_baru } = body;

        // Fetch user password hash
        const userRes = await db.execute({
          sql: `SELECT katasandi_hash FROM users WHERE UPPER(pgcode) = UPPER(?)`,
          args: [pgcode],
        });

        if (userRes.rows.length === 0) {
          set.status = 404;
          return { success: false, message: "Agent tidak ditemukan" };
        }

        const userRecord = userRes.rows[0];
        const isMatch = await Bun.password.verify(katasandi_lama, userRecord.katasandi_hash as string);

        if (!isMatch) {
          set.status = 401;
          return { success: false, message: "Kata sandi lama salah" };
        }

        if (katasandi_baru.length < 6) {
          set.status = 400;
          return { success: false, message: "Kata sandi baru minimal 6 karakter" };
        }

        const newHash = await Bun.password.hash(katasandi_baru);
        await db.execute({
          sql: `UPDATE users SET katasandi_hash = ? WHERE UPPER(pgcode) = UPPER(?)`,
          args: [newHash, pgcode],
        });

        return { success: true, message: "Kata sandi berhasil diperbarui" };
      } catch (error: any) {
        set.status = 500;
        return { success: false, message: "Server error" };
      }
    },
    {
      body: t.Object({
        katasandi_lama: t.String(),
        katasandi_baru: t.String({ minLength: 6 }),
      }),
    }
  );
