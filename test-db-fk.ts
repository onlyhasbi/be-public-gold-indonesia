import { createClient } from "@libsql/client";

const url = Bun.env.TURSO_DATABASE_URL!;
const authToken = Bun.env.TURSO_AUTH_TOKEN!;

const db = createClient({ url, authToken });

async function main() {
  try {
    const res = await db.execute("PRAGMA foreign_key_list(analytics);");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err: any) {
    console.error(err.message);
  }
}
main();
