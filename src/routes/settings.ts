import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { authGuard } from "../middleware/auth";
import cloudinary from "../config/cloudinary";
import {
  sanitizeString,
  isValidEmail,
  isValidUrl,
  validateImageFile,
} from "../utils/sanitize";
import { processImage } from "../utils/imageProcessor";
import type { InValue } from "@libsql/client";

export const settingsRoutes = new Elysia({
  prefix: "/settings",
  detail: { tags: ["Settings"] },
})
  .use(authGuard)
  .get("/", async ({ user, set }) => {
    try {
      if (!user) {
        set.status = 401;
        return { success: false, message: "Akses ditolak" };
      }
      // OPTIMIZATION: Use ID from JWT if available, else fallback to pgcode lookup
      let agentId = user.id;
      let querySql = `SELECT pgcode, pageid, foto_profil_url, nama_lengkap, nama_panggilan, email, no_telpon, link_group_whatsapp, sosmed_facebook, sosmed_instagram, sosmed_tiktok FROM users WHERE id = ?`;
      let queryArgs: InValue[] = [agentId ?? ""];

      if (!agentId) {
        querySql = `SELECT pgcode, pageid, foto_profil_url, nama_lengkap, nama_panggilan, email, no_telpon, link_group_whatsapp, sosmed_facebook, sosmed_instagram, sosmed_tiktok FROM users WHERE UPPER(pgcode) = UPPER(?)`;
        queryArgs = [user.sub ?? ""];
      }

      const res = await db.execute({
        sql: querySql,
        args: queryArgs,
      });

      if (res.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Agent tidak ditemukan" };
      }

      return { success: true, data: res.rows[0] };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Server error" };
    }
  })
  .put(
    "/",
    async ({ user, body, set }) => {
      try {
        if (!user) {
          set.status = 401;
          return { success: false, message: "Akses ditolak" };
        }
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

        // Sanitize all text inputs. If provided (even as ""), keep it so it can overwrite in DB.
        const namaLengkap =
          body.nama_lengkap !== undefined
            ? sanitizeString(body.nama_lengkap)
            : null;
        const namaPanggilan =
          body.nama_panggilan !== undefined
            ? sanitizeString(body.nama_panggilan)
            : null;
        const email =
          body.email !== undefined ? sanitizeString(body.email) || null : null;
        const noTelpon =
          body.no_telpon !== undefined ? sanitizeString(body.no_telpon) : null;
        const linkWa =
          body.link_group_whatsapp !== undefined
            ? sanitizeString(body.link_group_whatsapp)
            : null;
        const facebook =
          body.sosmed_facebook !== undefined
            ? sanitizeString(body.sosmed_facebook)
            : null;
        const instagram =
          body.sosmed_instagram !== undefined
            ? sanitizeString(body.sosmed_instagram)
            : null;
        const tiktok =
          body.sosmed_tiktok !== undefined
            ? sanitizeString(body.sosmed_tiktok)
            : null;

        // Validate email format if provided
        if (email && !isValidEmail(email)) {
          set.status = 400;
          return { success: false, message: "Format email tidak valid" };
        }

        // Check if email already exists for another user
        if (email) {
          const emailCheck = await db.execute({
            sql: `SELECT id FROM users WHERE email = ? AND ${user.id ? "id != ?" : "UPPER(pgcode) != UPPER(?)"}`,
            args: [email, user.id || user.sub || ""],
          });

          if (emailCheck.rows.length > 0) {
            set.status = 400;
            return {
              success: false,
              message: "Email sudah digunakan oleh akun lain",
            };
          }
        }

        // Validate URL formats if provided
        if (linkWa && !isValidUrl(linkWa)) {
          set.status = 400;
          return {
            success: false,
            message: "Format link WhatsApp tidak valid",
          };
        }

        // Update DB — identify agent by id or pgcode
        let updateSql = `
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
            WHERE id = ?
          `;
        let updateArgs: InValue[] = [
          photoUrl || null,
          namaLengkap,
          namaPanggilan,
          email,
          noTelpon,
          linkWa,
          facebook,
          instagram,
          tiktok,
          user.id ?? "",
        ];

        if (!user.id) {
          updateSql = updateSql.replace(
            "WHERE id = ?",
            "WHERE UPPER(pgcode) = UPPER(?)",
          );
          updateArgs[9] = user.sub ?? "";
        }

        await db.execute({ sql: updateSql, args: updateArgs });

        // Re-query updated data for client-side localStorage sync
        const updatedRes = await db.execute({
          sql: `SELECT pgcode, pageid, foto_profil_url, nama_lengkap, nama_panggilan, email, no_telpon, link_group_whatsapp, sosmed_facebook, sosmed_instagram, sosmed_tiktok FROM users WHERE ${user.id ? "id = ?" : "UPPER(pgcode) = UPPER(?)"}`,
          args: [user.id || user.sub || ""],
        });

        return {
          success: true,
          message: "Profil berhasil diperbarui",
          data: updatedRes.rows[0],
        };
      } catch (error) {
        console.error("### SETTINGS UPDATE ERROR:", error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Server error",
        };
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
    },
  )
  .patch(
    "/password",
    async ({ user, body, set }) => {
      try {
        if (!user) {
          set.status = 401;
          return { success: false, message: "Akses ditolak" };
        }
        const pgcode = user.sub;
        const { katasandi_lama, katasandi_baru } = body;

        // Fetch user password hash
        const userRes = await db.execute({
          sql: user.id
            ? `SELECT katasandi_hash FROM users WHERE id = ?`
            : `SELECT katasandi_hash FROM users WHERE UPPER(pgcode) = UPPER(?)`,
          args: [user.id || user.sub || ""],
        });

        if (userRes.rows.length === 0) {
          set.status = 404;
          return { success: false, message: "Agent tidak ditemukan" };
        }

        const userRecord = userRes.rows[0];
        const isMatch = await Bun.password.verify(
          katasandi_lama,
          userRecord.katasandi_hash as string,
        );

        if (!isMatch) {
          set.status = 401;
          return { success: false, message: "Kata sandi lama salah" };
        }

        if (katasandi_baru.length < 6) {
          set.status = 400;
          return {
            success: false,
            message: "Kata sandi baru minimal 6 karakter",
          };
        }

        const newHash = await Bun.password.hash(katasandi_baru);
        await db.execute({
          sql: user.id
            ? `UPDATE users SET katasandi_hash = ? WHERE id = ?`
            : `UPDATE users SET katasandi_hash = ? WHERE UPPER(pgcode) = UPPER(?)`,
          args: [newHash, user.id || user.sub || ""],
        });

        return { success: true, message: "Kata sandi berhasil diperbarui" };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Server error" };
      }
    },
    {
      body: t.Object({
        katasandi_lama: t.String(),
        katasandi_baru: t.String({ minLength: 6 }),
      }),
    },
  );
