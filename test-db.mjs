import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function run() {
  try {
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    console.log("TABLES:");
    console.log(tables.rows);
  } catch (e) {
    console.error("DB Error:", e);
  }
}
run();
