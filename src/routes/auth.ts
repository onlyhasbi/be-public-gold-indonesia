import { jwt } from "@elysiajs/jwt";
import type { InValue } from "@libsql/client";
import { Elysia, t } from "elysia";
import { randomUUID } from "node:crypto";
import { db } from "../db/db";
import type { UserRow } from "../types/db";
import { sanitizePGCode, sanitizePageId } from "../utils/sanitize";

export const authRoutes = new Elysia({
  prefix: "/auth",
  detail: { tags: ["Auth"] },
})
  .use(
    jwt({
      name: "jwt",
      secret: Bun.env.JWT_SECRET || "REDACTED_JWT_SECRET",
      exp: "7d", // Token expires in 7 days
    }),
  )
  .get("/check-pageid", async ({ query, set }) => {
    try {
      const pageid = sanitizePageId(query.pageid || "");
      if (!pageid || pageid.length < 3) {
        set.status = 400;
        return { success: false, message: "Page ID tidak valid" };
      }

      let sql = `SELECT id FROM users WHERE pageid = ?`;
      let args: InValue[] = [pageid];

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
    "/register",
    async ({ body, set, jwt }) => {
      try {
        const role = body.role || "pgbo";
        const katasandi = body.katasandi;

        if (katasandi.length < 6) {
          set.status = 400;
          return { success: false, message: "Katasandi minimal 6 karakter" };
        }

        const id = randomUUID();
        const hashedPassword = await Bun.password.hash(katasandi);

        if (role === "admin") {
          const email = body.email;
          const secretCode = body.secretCode;

          if (!email) {
            set.status = 400;
            return { success: false, message: "Email wajib diisi untuk admin" };
          }
          if (secretCode !== Bun.env.SECRET_CODE) {
            set.status = 401;
            return { success: false, message: "Secret code tidak valid" };
          }

          await db.execute({
            sql: `INSERT INTO users (id, role, email, katasandi_hash) VALUES (?, ?, ?, ?)`,
            args: [id, role, email, hashedPassword],
          });

          const token = await jwt.sign({ sub: email, id, role });
          return {
            success: true,
            message: "Registrasi admin berhasil",
            token,
            user: { id, email, role },
          };
        } else {
          // PGBO
          const pgcode = sanitizePGCode(body.pgcode || "");
          const pageid = sanitizePageId(body.pageid || "");

          if (!pgcode || pgcode.length < 3) {
            set.status = 400;
            return { success: false, message: "PGCode tidak valid" };
          }
          if (!pageid || pageid.length < 3) {
            set.status = 400;
            return { success: false, message: "Page ID tidak valid" };
          }

          const namaLengkap = body.nama_lengkap || null;
          const noTelpon = body.no_telpon || null;

          await db.execute({
            sql: `INSERT INTO users (id, role, pgcode, pageid, katasandi_hash, nama_lengkap, no_telpon) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
              id,
              "pgbo",
              pgcode,
              pageid,
              hashedPassword,
              namaLengkap,
              noTelpon,
            ],
          });

          const token = await jwt.sign({ sub: pgcode, id, role: "pgbo" });
          return {
            success: true,
            message: "Registrasi agen berhasil",
            token,
            user: {
              id,
              pgcode,
              pageid,
              role: "pgbo",
              nama_lengkap: namaLengkap,
            },
          };
        }
      } catch (error) {
        set.status = 400;
        const msg = error instanceof Error ? error.message : "";
        const isDuplicate = msg.includes("UNIQUE constraint failed");
        return {
          success: false,
          message: isDuplicate
            ? "Akun, PGCode, Email atau Page ID sudah terdaftar"
            : "Terjadi kesalahan pada server",
        };
      }
    },
    {
      body: t.Object({
        role: t.Optional(t.String()),
        pgcode: t.Optional(t.String()),
        pageid: t.Optional(t.String()),
        email: t.Optional(t.String()),
        katasandi: t.String(),
        secretCode: t.Optional(t.String()),
        nama_lengkap: t.Optional(t.String()),
        no_telpon: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/login",
    async ({ body, set, jwt }) => {
      try {
        const identifier = body.identifier?.trim();
        const katasandi = body.katasandi;

        if (!identifier) {
          set.status = 400;
          return { success: false, message: "Email atau PGCode tidak valid" };
        }

        // Explicit column list — excludes katasandi_hash, google tokens
        const safeColumns = `id, role, pgcode, email, pageid, foto_profil_url, nama_lengkap, nama_panggilan, no_telpon, link_group_whatsapp, sosmed_facebook, sosmed_instagram, sosmed_tiktok, is_active, created_at`;

        // Try email match first, then pgcode — avoids ambiguous cross-role matches
        let result = await db.execute({
          sql: `SELECT ${safeColumns}, katasandi_hash FROM users WHERE email = ?`,
          args: [identifier],
        });

        if (result.rows.length === 0) {
          result = await db.execute({
            sql: `SELECT ${safeColumns}, katasandi_hash FROM users WHERE UPPER(pgcode) = UPPER(?)`,
            args: [identifier],
          });
        }

        const user = result.rows[0] as unknown as UserRow | undefined;
        if (!user) {
          set.status = 401;
          return { success: false, message: "Kredensial salah" };
        }

        const isMatch = await Bun.password.verify(
          katasandi,
          user.katasandi_hash,
        );
        if (!isMatch) {
          set.status = 401;
          return { success: false, message: "Kredensial salah" };
        }

        // Sign token sub with the matched identifier
        // For Dealers (pgbo), we strictly use pgcode as sub to avoid identity mismatch
        const token = await jwt.sign({
          sub:
            (user.role === "pgbo"
              ? user.pgcode
              : user.email
                ? user.email
                : user.pgcode) ?? undefined,
          id: user.id,
          role: user.role,
        });

        // Strip katasandi_hash before sending to client
        const { katasandi_hash, ...safeUser } = user;

        return {
          success: true,
          message: "Login berhasil",
          token,
          user: safeUser,
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Terjadi kesalahan pada server",
        };
      }
    },
    {
      body: t.Object({
        identifier: t.String(),
        katasandi: t.String(),
      }),
    },
  );
