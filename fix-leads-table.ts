import { createClient } from "@libsql/client";

const url = Bun.env.TURSO_DATABASE_URL!;
const authToken = Bun.env.TURSO_AUTH_TOKEN!;
const db = createClient({ url, authToken });

async function main() {
  try {
    const res = await db.execute("PRAGMA table_info(leads);");
    const columns = res.rows.map((r) => r.name);
    if (!columns.includes("agent_id")) {
      console.log("No agent_id found, already migrated.");
    } else {
      console.log("agent_id still exists. Migrating table...");
      await db.execute("PRAGMA foreign_keys = OFF;");
      await db.execute("BEGIN TRANSACTION;");
      await db.execute("DROP TABLE IF EXISTS leads_old;");
      await db.execute("ALTER TABLE leads RENAME TO leads_old;");
      await db.execute(`
        CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          nama TEXT,
          branch TEXT,
          no_telpon TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `);
      await db.execute(`
        INSERT INTO leads (id, user_id, nama, branch, no_telpon, created_at)
        SELECT id, CASE WHEN user_id != '' THEN user_id ELSE agent_id END, nama, branch, no_telpon, created_at FROM leads_old;
      `);
      await db.execute("DROP TABLE leads_old;");
      await db.execute("COMMIT;");
      await db.execute("PRAGMA foreign_keys = ON;");
      console.log("Migration complete!");
    }
  } catch (err: any) {
    console.error("Migration failed:", err.message);
  } finally {
    process.exit(0);
  }
}
main();
