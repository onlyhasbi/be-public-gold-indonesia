import { createClient } from "@libsql/client";

const url = Bun.env.TURSO_DATABASE_URL!;
const authToken = Bun.env.TURSO_AUTH_TOKEN!;
const db = createClient({ url, authToken });

async function main() {
  try {
    const res = await db.execute("PRAGMA table_info(analytics);");
    const columns = res.rows.map((r) => r.name);
    if (!columns.includes("agent_id")) {
      console.log("No agent_id found, already migrated.");
    } else {
      console.log("agent_id still exists. Migrating table...");
      await db.execute("PRAGMA foreign_keys = OFF;");
      await db.execute("BEGIN TRANSACTION;");
      await db.execute("DROP TABLE IF EXISTS analytics_old;");
      await db.execute("ALTER TABLE analytics RENAME TO analytics_old;");
      await db.execute(`
        CREATE TABLE IF NOT EXISTS analytics (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
      `);
      await db.execute(`
        INSERT INTO analytics (id, user_id, event_type, created_at)
        SELECT id, CASE WHEN user_id != '' THEN user_id ELSE agent_id END, event_type, created_at FROM analytics_old;
      `);
      await db.execute("DROP TABLE analytics_old;");
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
