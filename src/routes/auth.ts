import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { jwt } from "@elysiajs/jwt";
import { randomUUID } from "node:crypto";
import { rateLimit } from "../middleware/rateLimit";
import { sanitizePGCode, sanitizePageId } from "../utils/sanitize";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(
    jwt({
      name: "jwt",
      secret: Bun.env.JWT_SECRET || "REDACTED_JWT_SECRET",
      exp: "7d", // Token expires in 7 days
    })
  )
  .use(rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }))
  .get("/check-pageid", async ({ query, set }) => {
    try {
      const pageid = sanitizePageId(query.pageid || "");
      if (!pageid || pageid.length < 3) {
        set.status = 400;
        return { success: false, message: "Page ID tidak valid" };
      }

      let sql = `SELECT id FROM users WHERE pageid = ?`;
      let args: any[] = [pageid];

      const res = await db.execute({ sql, args });
      return { 
        success: true, 
        isAvailable: res.rows.length === 0 
      };
    } catch (error: any) {
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

          const token = await jwt.sign({ sub: email, role });
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
            args: [id, "pgbo", pgcode, pageid, hashedPassword, namaLengkap, noTelpon],
          });

          const token = await jwt.sign({ sub: pgcode, role: "pgbo" });
          return {
            success: true,
            message: "Registrasi agen berhasil",
            token,
            user: { id, pgcode, pageid, role: "pgbo", nama_lengkap: namaLengkap },
          };
        }
      } catch (error: any) {
        set.status = 400;
        const isDuplicate = error.message?.includes("UNIQUE constraint failed");
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
        no_telpon: t.String(),
      }),
    }
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

        // Try email match first, then pgcode — avoids ambiguous cross-role matches
        let result = await db.execute({
          sql: `SELECT * FROM users WHERE email = ?`,
          args: [identifier],
        });

        if (result.rows.length === 0) {
          result = await db.execute({
            sql: `SELECT * FROM users WHERE UPPER(pgcode) = UPPER(?)`,
            args: [identifier],
          });
        }

        const user = result.rows[0] as any;
        if (!user) {
          set.status = 401;
          return { success: false, message: "Kredensial salah" };
        }

        const isMatch = await Bun.password.verify(
          katasandi,
          user.katasandi_hash
        );
        if (!isMatch) {
          set.status = 401;
          return { success: false, message: "Kredensial salah" };
        }

        // Sign token sub with the matched identifier
        // For Dealers (pgbo), we strictly use pgcode as sub to avoid identity mismatch
        const token = await jwt.sign({ 
          sub: user.role === 'pgbo' ? user.pgcode : (user.email ? user.email : user.pgcode), 
          role: user.role 
        });

        const { katasandi_hash, ...safeUser } = user;

        return {
          success: true,
          message: "Login berhasil",
          token,
          user: safeUser,
        };
      } catch (error: any) {
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
    }
  );
