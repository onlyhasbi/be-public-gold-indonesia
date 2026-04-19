import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { adminGuard } from "../middleware/auth";
import { randomUUID } from "node:crypto";
import {
  sanitizePGCode,
  sanitizePageId,
  validateImageFile,
  escapeFts,
} from "../utils/sanitize";
import cloudinary from "../config/cloudinary";
import { processImage } from "../utils/imageProcessor";
import { getSetting, updateSetting } from "../utils/settings";
import type { InValue } from "@libsql/client";
import type { UserRow } from "../types/db";

export const adminRoutes = new Elysia({
  prefix: "/admin",
  detail: { tags: ["Admin"] },
})
  .use(adminGuard)
  .get("/profile", async ({ user, set }) => {
    try {
      if (!user) {
        set.status = 401;
        return { success: false, message: "Akses ditolak" };
      }

      const adminId = user.id;
      const res = await db.execute({
        sql: `SELECT id, role, email, created_at FROM users WHERE id = ? AND role = 'admin'`,
        args: [adminId ?? ""],
      });

      if (res.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Admin tidak ditemukan" };
      }

      return { success: true, data: res.rows[0] };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Server error" };
    }
  })
  .get("/pgbo", async ({ query, set }) => {
    try {
      const search = query.search as string | undefined;
      let sql = `
        SELECT 
          u.id, u.pgcode, u.pageid, u.nama_lengkap, u.email, 
          u.no_telpon, u.is_active, u.created_at
        FROM users u
      `;
      const args: InValue[] = [];

      if (search) {
        const safeSearch = escapeFts(search);
        if (safeSearch) {
          sql += ` JOIN users_fts fts ON u.id = fts.id WHERE u.role = 'pgbo' AND users_fts MATCH ?`;
          args.push(safeSearch);
        } else {
          sql += ` WHERE u.role = 'pgbo'`;
        }
      } else {
        sql += ` WHERE u.role = 'pgbo'`;
      }

      sql += ` ORDER BY u.created_at DESC`;

      const result = await db.execute({ sql, args });

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      console.error("GET /pgbo error:", error);
      set.status = 500;
      return { success: false, message: "Gagal mengambil data PGBO" };
    }
  })
  .get("/pgbo/check-pageid", async ({ query, set }) => {
    try {
      const pageid = sanitizePageId(query.pageid || "");
      if (!pageid || pageid.length < 3) {
        set.status = 400;
        return { success: false, message: "Page ID tidak valid" };
      }

      let sql = `SELECT id FROM users WHERE pageid = ?`;
      let args: InValue[] = [pageid];

      if (query.excludeId) {
        sql += ` AND id != ?`;
        args.push(query.excludeId);
      }

      const res = await db.execute({ sql, args });
      return {
        success: true,
        isAvailable: res.rows.length === 0,
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Server error" };
    }
  })
  .post(
    "/pgbo",
    async ({ body, set }) => {
      try {
        const pgcode = sanitizePGCode(body.pgcode);
        const pageid = sanitizePageId(body.pageid);
        const katasandi = body.katasandi;

        if (!pgcode || pgcode.length < 3) {
          set.status = 400;
          return { success: false, message: "PGCode tidak valid" };
        }
        if (!pageid || pageid.length < 3) {
          set.status = 400;
          return { success: false, message: "Page ID tidak valid" };
        }
        if (katasandi.length < 6) {
          set.status = 400;
          return { success: false, message: "Katasandi minimal 6 karakter" };
        }

        const id = randomUUID();
        const hashedPassword = await Bun.password.hash(katasandi);
        const nama = body.nama_lengkap?.trim() || null;

        let photoUrl = null;
        if (body.foto_profil instanceof File) {
          const validation = validateImageFile(body.foto_profil);
          if (!validation.valid) {
            set.status = 400;
            return { success: false, message: validation.error };
          }

          const processed = await processImage(body.foto_profil);
          const base64Str = processed.buffer.toString("base64");
          const dataUri = `data:${processed.mimeType};base64,${base64Str}`;

          const uploadRes = await cloudinary.uploader.upload(dataUri, {
            folder: "profile_pictures",
            format: "webp",
          });

          photoUrl = uploadRes.secure_url;
        }

        let no_telpon = body.no_telpon?.trim() || null;

        await db.execute({
          sql: `INSERT INTO users (id, role, pgcode, pageid, katasandi_hash, nama_lengkap, foto_profil_url, no_telpon) VALUES (?, 'pgbo', ?, ?, ?, ?, ?, ?)`,
          args: [id, pgcode, pageid, hashedPassword, nama, photoUrl, no_telpon],
        });

        return {
          success: true,
          message: "PGBO berhasil didaftarkan",
          data: { id, pgcode, pageid },
        };
      } catch (error) {
        set.status = 400;
        const msg = error instanceof Error ? error.message : "";
        const isDuplicate = msg.includes("UNIQUE constraint failed");
        return {
          success: false,
          message: isDuplicate
            ? "PGCode atau Page ID sudah terdaftar"
            : "Terjadi kesalahan pada server",
        };
      }
    },
    {
      body: t.Object({
        pgcode: t.String({ minLength: 3, maxLength: 50 }),
        katasandi: t.String({ minLength: 6, maxLength: 128 }),
        pageid: t.String({ minLength: 3, maxLength: 50 }),
        nama_lengkap: t.Optional(t.String({ maxLength: 100 })),
        no_telpon: t.String({ maxLength: 20 }),
        foto_profil: t.Optional(t.File({ maxSize: "2m" })),
      }),
    },
  )
  .delete("/pgbo/:id", async ({ params, set }) => {
    try {
      const userId = params.id;

      // Fetch user's profile photo URL before deleting
      const userResult = await db.execute({
        sql: `SELECT foto_profil_url FROM users WHERE id = ? AND role = 'pgbo'`,
        args: [userId],
      });

      // Delete Cloudinary image if exists
      const photoUrl = userResult.rows[0]?.foto_profil_url as string | null;
      if (photoUrl && photoUrl.includes("cloudinary")) {
        try {
          // Extract public_id from Cloudinary URL: .../profile_pictures/abc123.webp → profile_pictures/abc123
          const parts = photoUrl.split("/");
          const folder = parts[parts.length - 2];
          const fileWithExt = parts[parts.length - 1];
          const publicId = `${folder}/${fileWithExt.split(".")[0]}`;
          await cloudinary.uploader.destroy(publicId);
        } catch (cloudErr) {
          // Log but don't block deletion if Cloudinary cleanup fails
          console.warn("Cloudinary cleanup failed:", cloudErr);
        }
      }

      // Atomic delete: all or nothing using batch transaction
      const results = await db.batch([
        {
          sql: `DELETE FROM leads WHERE user_id = ?`,
          args: [userId],
        },
        {
          sql: `DELETE FROM analytics WHERE user_id = ?`,
          args: [userId],
        },
        {
          sql: `DELETE FROM users WHERE id = ? AND role = 'pgbo'`,
          args: [userId],
        },
      ]);

      // Check if the user was actually deleted (last query result)
      if (results[2].rowsAffected === 0) {
        set.status = 404;
        return { success: false, message: "Data PGBO tidak ditemukan" };
      }

      return {
        success: true,
        message: "Akun PGBO beserta data terkait telah dihapus permanen",
      };
    } catch (error) {
      console.error("### DELETE ERROR:", error);
      set.status = 500;
      return {
        success: false,
        message: "Terjadi kesalahan sistem saat menghapus data",
      };
    }
  })
  .patch("/pgbo/:id/toggle", async ({ params, set }) => {
    try {
      const userId = params.id;

      // Toggle is_active: 1 -> 0, 0 -> 1
      const result = await db.execute({
        sql: `UPDATE users SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ? AND role = 'pgbo' RETURNING is_active`,
        args: [userId],
      });

      if (result.rows.length === 0) {
        set.status = 404;
        return { success: false, message: "Data PGBO tidak ditemukan" };
      }

      const newStatus = result.rows[0].is_active;
      return {
        success: true,
        message: newStatus
          ? "PGBO berhasil diaktifkan"
          : "PGBO berhasil dinonaktifkan",
        data: { is_active: newStatus },
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan sistem" };
    }
  })
  .put(
    "/pgbo/:id",
    async ({ params, body, set }) => {
      try {
        const userId = params.id;

        // Build dynamic SET clause
        const fields: string[] = [];
        const args: InValue[] = [];

        if (body.nama_lengkap !== undefined) {
          fields.push("nama_lengkap = ?");
          args.push(body.nama_lengkap.trim() || null);
        }
        if (body.pgcode !== undefined) {
          const pgcode = sanitizePGCode(body.pgcode);
          if (!pgcode || pgcode.length < 3) {
            set.status = 400;
            return {
              success: false,
              message: "PGCode tidak valid (min 3 karakter)",
            };
          }
          fields.push("pgcode = ?");
          args.push(pgcode);
        }
        if (body.pageid !== undefined) {
          const pageid = sanitizePageId(body.pageid);
          if (!pageid || pageid.length < 3) {
            set.status = 400;
            return {
              success: false,
              message: "Page ID tidak valid (min 3 karakter)",
            };
          }
          fields.push("pageid = ?");
          args.push(pageid);
        }
        if (body.no_telpon !== undefined) {
          fields.push("no_telpon = ?");
          args.push(body.no_telpon.trim() || null);
        }

        if (body.foto_profil instanceof File) {
          const validation = validateImageFile(body.foto_profil);
          if (!validation.valid) {
            set.status = 400;
            return { success: false, message: validation.error };
          }
          const processed = await processImage(body.foto_profil);
          const base64Str = processed.buffer.toString("base64");
          const dataUri = `data:${processed.mimeType};base64,${base64Str}`;

          const uploadRes = await cloudinary.uploader.upload(dataUri, {
            folder: "profile_pictures",
            format: "webp",
          });

          fields.push("foto_profil_url = ?");
          args.push(uploadRes.secure_url);
        } else if (body.foto_profil === null) {
          // Allow explicit removal if needed (but usually we just don't pass it or pass empty string, but multipart makes it tricky, let's keep it simple)
        }

        if (fields.length === 0) {
          set.status = 400;
          return { success: false, message: "Tidak ada data yang diubah" };
        }

        args.push(userId);
        const result = await db.execute({
          sql: `UPDATE users SET ${fields.join(", ")} WHERE id = ? AND role = 'pgbo'`,
          args,
        });

        if (result.rowsAffected === 0) {
          set.status = 404;
          return { success: false, message: "Data PGBO tidak ditemukan" };
        }

        return {
          success: true,
          message: "Data PGBO berhasil diperbarui",
        };
      } catch (error) {
        set.status = 400;
        const msg = error instanceof Error ? error.message : "";
        const isDuplicate = msg.includes("UNIQUE constraint failed");
        return {
          success: false,
          message: isDuplicate
            ? "PGCode, atau Page ID sudah digunakan"
            : "Terjadi kesalahan pada server",
        };
      }
    },
    {
      body: t.Object({
        nama_lengkap: t.Optional(t.String({ maxLength: 100 })),
        pgcode: t.Optional(t.String({ maxLength: 50 })),
        pageid: t.Optional(t.String({ maxLength: 50 })),
        no_telpon: t.Optional(t.String({ maxLength: 20 })),
        foto_profil: t.Optional(t.File({ maxSize: "2m" })),
      }),
    },
  )
  .get("/settings/secret-code", async ({ set }) => {
    try {
      const code = await getSetting("portal_secret_code");
      const autoRotate = await getSetting("portal_secret_auto_rotate");
      return {
        success: true,
        data: {
          code,
          auto_rotate: autoRotate === "true",
        },
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Gagal mengambil kode rahasia" };
    }
  })
  .patch(
    "/settings/secret-code",
    async ({ body, set }) => {
      try {
        const { code, auto_rotate } = body;
        if (!code || code.trim().length < 3) {
          set.status = 400;
          return { success: false, message: "Kode rahasia minimal 3 karakter" };
        }
        // Sanitize: remove all domestic whitespace
        const cleanCode = code.replace(/\s+/g, "");
        await updateSetting("portal_secret_code", cleanCode);
        await updateSetting(
          "portal_secret_auto_rotate",
          auto_rotate ? "true" : "false",
        );
        return { success: true, message: "Kode rahasia berhasil diperbarui" };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Gagal memperbarui kode rahasia" };
      }
    },
    {
      body: t.Object({
        code: t.String(),
        auto_rotate: t.Boolean(),
      }),
    },
  )
  .post(
    "/pgbo/bulk-delete",
    async ({ body, set }) => {
      try {
        const { ids } = body;
        if (!ids || ids.length === 0) {
          set.status = 400;
          return { success: false, message: "Tidak ada ID yang dipilih" };
        }

        // For each id, delete leads, analytics, cloudinary photo, then user
        let deletedCount = 0;
        for (const id of ids) {
          // Fetch photo URL
          const userRes = await db.execute({
            sql: `SELECT foto_profil_url FROM users WHERE id = ? AND role = 'pgbo'`,
            args: [id],
          });

          const photoUrl = userRes.rows[0]?.foto_profil_url as string | null;
          if (photoUrl && photoUrl.includes("cloudinary")) {
            try {
              const parts = photoUrl.split("/");
              const folder = parts[parts.length - 2];
              const fileWithExt = parts[parts.length - 1];
              const publicId = `${folder}/${fileWithExt.split(".")[0]}`;
              await cloudinary.uploader.destroy(publicId);
            } catch (cloudErr) {
              console.warn("Cloudinary cleanup failed:", cloudErr);
            }
          }

          const results = await db.batch([
            { sql: `DELETE FROM leads WHERE user_id = ?`, args: [id] },
            { sql: `DELETE FROM analytics WHERE user_id = ?`, args: [id] },
            {
              sql: `DELETE FROM users WHERE id = ? AND role = 'pgbo'`,
              args: [id],
            },
          ]);

          if (results[2].rowsAffected > 0) deletedCount++;
        }

        return {
          success: true,
          message: `${deletedCount} PGBO berhasil dihapus`,
        };
      } catch (error) {
        console.error("### BULK DELETE ERROR:", error);
        set.status = 500;
        return {
          success: false,
          message: "Terjadi kesalahan saat menghapus data",
        };
      }
    },
    {
      body: t.Object({
        ids: t.Array(t.String()),
      }),
    },
  )
  .patch(
    "/pgbo/bulk-toggle",
    async ({ body, set }) => {
      try {
        const { ids, active } = body;
        if (!ids || ids.length === 0) {
          set.status = 400;
          return { success: false, message: "Tidak ada ID yang dipilih" };
        }

        const newStatus = active ? 1 : 0;
        const statements = ids.map((id: string) => ({
          sql: `UPDATE users SET is_active = ? WHERE id = ? AND role = 'pgbo'`,
          args: [newStatus, id],
        }));

        await db.batch(statements);

        return {
          success: true,
          message: `${ids.length} PGBO berhasil ${active ? "diaktifkan" : "dinonaktifkan"}`,
        };
      } catch (error) {
        console.error("### BULK TOGGLE ERROR:", error);
        set.status = 500;
        return {
          success: false,
          message: "Terjadi kesalahan saat mengubah status",
        };
      }
    },
    {
      body: t.Object({
        ids: t.Array(t.String()),
        active: t.Boolean(),
      }),
    },
  );
