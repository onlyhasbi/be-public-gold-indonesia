import { Elysia, t } from "elysia";
import { db } from "../db/db";
import { authGuard } from "../middleware/auth";
import { generateVCardFile } from "../utils/vcard_utils";
import { escapeFts } from "../utils/sanitize";
import type { InValue } from "@libsql/client";

export const overviewRoutes = new Elysia({
  prefix: "/overview",
  detail: { tags: ["Overview"] },
})
  .use(authGuard)
  .get("/", async ({ query, user, set }) => {
    try {
      if (!user) {
        set.status = 401;
        return { success: false, message: "Akses ditolak" };
      }
      const search = query.search as string | undefined;

      // OPTIMIZATION: Use ID from JWT if available, else fallback to pgcode lookup
      let agentId = user.id;
      if (!agentId) {
        const agentRes = await db.execute({
          sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
          args: [user.sub ?? ""],
        });
        if (agentRes.rows.length === 0) {
          set.status = 404;
          return { success: false, message: "Agent tidak ditemukan" };
        }
        agentId = String(agentRes.rows[0].id);
      }

      // Get stats using agent internal id (parameterized — safe from SQL injection)
      const visitorCountRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM analytics WHERE user_id = ? AND event_type = 'visitor'`,
        args: [agentId ?? ""],
      });
      const whatsappCountRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM analytics WHERE user_id = ? AND event_type = 'whatsapp_click'`,
        args: [agentId ?? ""],
      });
      const leadsCountRes = await db.execute({
        sql: `SELECT COUNT(*) as count FROM leads WHERE user_id = ?`,
        args: [agentId ?? ""],
      });

      // Get ALL registrants (no limit) with id and exported_at
      let leadsSql = `SELECT l.id, l.nama, l.branch, l.no_telpon, l.exported_at, l.created_at FROM leads l`;
      const leadsArgs: InValue[] = [agentId ?? ""];

      if (search) {
        const safeSearch = escapeFts(search);
        if (safeSearch) {
          leadsSql += ` JOIN leads_fts fts ON l.id = fts.id WHERE l.user_id = ? AND leads_fts MATCH ?`;
          leadsArgs.push(safeSearch);
        } else {
          leadsSql += ` WHERE l.user_id = ?`;
        }
      } else {
        leadsSql += ` WHERE l.user_id = ?`;
      }

      leadsSql += ` ORDER BY l.created_at DESC`;

      const leadsRes = await db.execute({
        sql: leadsSql,
        args: leadsArgs,
      });

      return {
        success: true,
        data: {
          total_pengunjung: Number(visitorCountRes.rows[0].count),
          total_klik_whatsapp: Number(whatsappCountRes.rows[0].count),
          total_pendaftar: Number(leadsCountRes.rows[0].count),
          tabel_pendaftar_terbaru: leadsRes.rows,
        },
      };
    } catch (error) {
      set.status = 500;
      return { success: false, message: "Terjadi kesalahan pada server" };
    }
  })
  .post(
    "/leads/export-vcf",
    async ({ body, user, set }) => {
      try {
        const { ids } = body;
        if (!ids || ids.length === 0) {
          set.status = 400;
          return { success: false, message: "Tidak ada kontak yang dipilih" };
        }

        if (!user) {
          set.status = 401;
          return { success: false, message: "Akses ditolak" };
        }
        let agentId = user.id;
        if (!agentId) {
          const agentRes = await db.execute({
            sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
            args: [user.sub ?? ""],
          });
          if (agentRes.rows.length === 0) {
            set.status = 404;
            return { success: false, message: "Agent tidak ditemukan" };
          }
          agentId = String(agentRes.rows[0].id);
        }

        // Fetch leads data for the given ids
        const placeholders = ids.map(() => "?").join(", ");
        const leadsRes = await db.execute({
          sql: `SELECT id, nama, branch, no_telpon FROM leads WHERE user_id = ? AND id IN (${placeholders})`,
          args: [agentId ?? "", ...ids],
        });

        if (leadsRes.rows.length === 0) {
          set.status = 404;
          return {
            success: false,
            message: "Tidak ada data pendaftar yang ditemukan",
          };
        }

        // Generate vCard file content
        const vcfContent = generateVCardFile(
          leadsRes.rows.map((lead) => ({
            nama: lead.nama as string,
            branch: lead.branch as string,
            no_telpon: lead.no_telpon as string,
          })),
        );

        // Mark all exported leads
        for (const lead of leadsRes.rows) {
          await db.execute({
            sql: `UPDATE leads SET exported_at = CURRENT_TIMESTAMP WHERE id = ?`,
            args: [lead.id],
          });
        }

        // Return as downloadable .vcf file
        set.headers["Content-Type"] = "text/vcard; charset=utf-8";
        set.headers["Content-Disposition"] =
          `attachment; filename="kontak-pendaftar.vcf"`;
        return vcfContent;
      } catch (error) {
        console.error("### EXPORT VCF ERROR:", error);
        set.status = 500;
        return {
          success: false,
          message: "Terjadi kesalahan saat mengekspor kontak",
        };
      }
    },
    {
      body: t.Object({
        ids: t.Array(t.String()),
      }),
    },
  )
  .post(
    "/leads/bulk-delete",
    async ({ body, user, set }) => {
      try {
        const { ids } = body;
        if (!ids || ids.length === 0) {
          set.status = 400;
          return { success: false, message: "Tidak ada data yang dipilih" };
        }

        if (!user) {
          set.status = 401;
          return { success: false, message: "Akses ditolak" };
        }
        let agentId = user.id;
        if (!agentId) {
          const agentRes = await db.execute({
            sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
            args: [user.sub ?? ""],
          });
          if (agentRes.rows.length === 0) {
            set.status = 404;
            return { success: false, message: "Agent tidak ditemukan" };
          }
          agentId = String(agentRes.rows[0].id);
        }

        const placeholders = ids.map(() => "?").join(", ");
        const result = await db.execute({
          sql: `DELETE FROM leads WHERE user_id = ? AND id IN (${placeholders})`,
          args: [agentId ?? "", ...ids],
        });

        return {
          success: true,
          message: `${result.rowsAffected} pendaftar berhasil dihapus`,
        };
      } catch (error) {
        console.error("### BULK DELETE LEAD ERROR:", error);
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
  .delete("/leads/:id", async ({ params, user, set }) => {
    try {
      if (!user) {
        set.status = 401;
        return { success: false, message: "Akses ditolak" };
      }
      let agentId = user.id;
      if (!agentId) {
        const agentRes = await db.execute({
          sql: `SELECT id FROM users WHERE UPPER(pgcode) = UPPER(?)`,
          args: [user.sub ?? ""],
        });
        if (agentRes.rows.length === 0) {
          set.status = 404;
          return { success: false, message: "Agent tidak ditemukan" };
        }
        agentId = agentRes.rows[0].id as string;
      }

      const result = await db.execute({
        sql: `DELETE FROM leads WHERE id = ? AND user_id = ?`,
        args: [params.id, agentId ?? ""],
      });

      if (result.rowsAffected === 0) {
        set.status = 404;
        return { success: false, message: "Data pendaftar tidak ditemukan" };
      }

      return { success: true, message: "Pendaftar berhasil dihapus" };
    } catch (error) {
      console.error("### DELETE LEAD ERROR:", error);
      set.status = 500;
      return {
        success: false,
        message: "Terjadi kesalahan saat menghapus data",
      };
    }
  });
