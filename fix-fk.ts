import { createClient } from "@libsql/client";

const url = Bun.env.TURSO_DATABASE_URL!;
const authToken = Bun.env.TURSO_AUTH_TOKEN!;

const db = createClient({ url, authToken });

async function main() {
  try {
    const res = await db.execute("SELECT * FROM agents LIMIT 1;");
    let agentId = "";
    if (res.rows.length === 0) {
      console.log("No agent found, inserting placeholder");
      await db.execute({
        sql: "INSERT INTO agents (id, pgcode, namalengkap, email, katasandi_hash, pageid, is_active) VALUES ('legacy_placeholder', 'PG00000', 'Legacy', 'legacy@p.com', 'hash', 'legacy', 1)",
        args: [],
      });
      agentId = "legacy_placeholder";
    } else {
      agentId = res.rows[0].id as string;
    }
    console.log("Valid agent ID to use:", agentId);
  } catch (err: any) {
    console.error(err.message);
  }
}
main();
