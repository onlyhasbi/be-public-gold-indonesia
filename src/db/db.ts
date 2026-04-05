import { createClient } from "@libsql/client";

// Use an in-memory SQLite if no URL is provided, or a local file 'local.db'
// For production, ensure TURSO_DATABASE_URL is set in .env
const url = Bun.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = Bun.env.TURSO_AUTH_TOKEN;

// Validation for production environment
if (Bun.env.NODE_ENV === "production" && !Bun.env.TURSO_DATABASE_URL) {
  console.warn("⚠️ TURSO_DATABASE_URL is not set in production. Falling back to local file (which may fail in Serverless).");
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

  // Migration: add is_active column if it doesn't exist yet
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  } catch (_e) {
    // Column already exists — ignore
  }

  // Migration: add nama_panggilan column if it doesn't exist yet
  try {
    await db.execute(`ALTER TABLE users ADD COLUMN nama_panggilan TEXT`);
  } catch (_e) {
    // Column already exists — ignore
  }

  // Migration: add user_id column to leads if it doesn't exist yet
  try {
    await db.execute(`ALTER TABLE leads ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
  } catch (_e) {
    // Column already exists or table doesn't exist yet — ignore
  }

  // Migration: add user_id column to analytics if it doesn't exist yet
  try {
    await db.execute(`ALTER TABLE analytics ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
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

  console.log("Database tables verified!");
};
