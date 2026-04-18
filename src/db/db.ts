import { createClient } from "@libsql/client";

// Use an in-memory SQLite if no URL is provided, or a local file 'local.db'
// For production, ensure TURSO_DATABASE_URL is set in .env
const url = Bun.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = Bun.env.TURSO_AUTH_TOKEN;

// Validation for production environment
if (Bun.env.NODE_ENV === "production" && !Bun.env.TURSO_DATABASE_URL) {
  console.warn(
    "⚠️ TURSO_DATABASE_URL is not set in production. Falling back to local file (which may fail in Serverless).",
  );
}

export const db = createClient({
  url,
  authToken,
});

export const setupDatabase = async () => {
  // Uncomment below if you want to perform a clean wipe in dev:
  // await db.execute("DROP TABLE IF EXISTS leads");
  // await db.execute("DROP TABLE IF EXISTS analytics");
  // await db.execute("DROP TABLE IF EXISTS agents");
  // await db.execute("DROP TABLE IF EXISTS admins");
  // await db.execute("DROP TABLE IF EXISTS users");

  // Create Users table (Unified credential)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'pgbo',
      pgcode TEXT UNIQUE,
      email TEXT UNIQUE,
      katasandi_hash TEXT NOT NULL,
      pageid TEXT UNIQUE,
      foto_profil_url TEXT,
      nama_lengkap TEXT,
      nama_panggilan TEXT,
      no_telpon TEXT,
      link_group_whatsapp TEXT,
      sosmed_facebook TEXT,
      sosmed_instagram TEXT,
      sosmed_tiktok TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Cleanup: remove google auth columns if they exist
  try {
    const columnsRes = await db.execute(`PRAGMA table_info(users)`);
    const kolom = columnsRes.rows.map((r) => String(r.name));
    if (kolom.includes("google_refresh_token"))
      await db.execute(`ALTER TABLE users DROP COLUMN google_refresh_token`);
    if (kolom.includes("google_access_token"))
      await db.execute(`ALTER TABLE users DROP COLUMN google_access_token`);
    if (kolom.includes("google_token_expiry"))
      await db.execute(`ALTER TABLE users DROP COLUMN google_token_expiry`);
  } catch (_e) {
    console.log("Skipping column drop");
  }

  // Migration: add user_id column to leads if it doesn't exist yet
  try {
    await db.execute(
      `ALTER TABLE leads ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
    );
  } catch (_e) {
    // Column already exists or table doesn't exist yet — ignore
  }

  // Migration: add exported_at column to leads for tracking Google Contacts sync
  try {
    await db.execute(`ALTER TABLE leads ADD COLUMN exported_at DATETIME`);
  } catch (_e) {
    // Column already exists — ignore
  }

  // Migration: add user_id column to analytics if it doesn't exist yet
  try {
    await db.execute(
      `ALTER TABLE analytics ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
    );
  } catch (_e) {
    // Column already exists or table doesn't exist yet — ignore
  }

  // Create Leads table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      nama TEXT,
      branch TEXT,
      no_telpon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Create Analytics table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Create System Settings table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initialize default settings if not exists
  const checkSecret = await db.execute(
    "SELECT value FROM system_settings WHERE key = 'portal_secret_code'",
  );
  if (checkSecret.rows.length === 0) {
    await db.execute({
      sql: "INSERT INTO system_settings (key, value) VALUES ('portal_secret_code', ?)",
      args: [Bun.env.SECRET_CODE || "unlimited"],
    });
  }

  const checkRotation = await db.execute(
    "SELECT value FROM system_settings WHERE key = 'last_rotation_date'",
  );
  if (checkRotation.rows.length === 0) {
    await db.execute({
      sql: "INSERT INTO system_settings (key, value) VALUES ('last_rotation_date', ?)",
      args: [new Date().toISOString().split("T")[0]],
    });
  }

  // --- FTS5 Indexing for 'users' (Admin Search) ---
  await db.execute(
    `CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(id UNINDEXED, pgcode, nama_lengkap, pageid, tokenize='trigram')`,
  );
  // Populate users_fts if empty
  try {
    const checkUsersFts = await db.execute(
      `SELECT COUNT(*) as count FROM users_fts`,
    );
    if (checkUsersFts.rows[0].count === 0) {
      await db.execute(
        `INSERT INTO users_fts(id, pgcode, nama_lengkap, pageid) SELECT id, pgcode, nama_lengkap, pageid FROM users`,
      );
    }
  } catch (e) {
    console.error("Failed to populate users_fts:", e);
  }
  // Triggers for users_fts sync
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS users_ai AFTER INSERT ON users BEGIN INSERT INTO users_fts(id, pgcode, nama_lengkap, pageid) VALUES (new.id, new.pgcode, new.nama_lengkap, new.pageid); END;`,
  );
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS users_ad AFTER DELETE ON users BEGIN DELETE FROM users_fts WHERE id = old.id; END;`,
  );
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS users_au AFTER UPDATE ON users BEGIN UPDATE users_fts SET pgcode = new.pgcode, nama_lengkap = new.nama_lengkap, pageid = new.pageid WHERE id = old.id; END;`,
  );

  // --- FTS5 Indexing for 'leads' (Overview Search) ---
  await db.execute(
    `CREATE VIRTUAL TABLE IF NOT EXISTS leads_fts USING fts5(id UNINDEXED, nama, branch, no_telpon, tokenize='trigram')`,
  );
  // Populate leads_fts if empty
  try {
    const checkLeadsFts = await db.execute(
      `SELECT COUNT(*) as count FROM leads_fts`,
    );
    if (checkLeadsFts.rows[0].count === 0) {
      await db.execute(
        `INSERT INTO leads_fts(id, nama, branch, no_telpon) SELECT id, nama, branch, no_telpon FROM leads`,
      );
    }
  } catch (e) {
    console.error("Failed to populate leads_fts:", e);
  }
  // Triggers for leads_fts sync
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS leads_ai AFTER INSERT ON leads BEGIN INSERT INTO leads_fts(id, nama, branch, no_telpon) VALUES (new.id, new.nama, new.branch, new.no_telpon); END;`,
  );
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS leads_ad AFTER DELETE ON leads BEGIN DELETE FROM leads_fts WHERE id = old.id; END;`,
  );
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS leads_au AFTER UPDATE ON leads BEGIN UPDATE leads_fts SET nama = new.nama, branch = new.branch, no_telpon = new.no_telpon WHERE id = old.id; END;`,
  );

  console.log("Database tables verified!");
};
