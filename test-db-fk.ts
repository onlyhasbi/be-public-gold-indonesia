import { createClient } from "@libsql/client";

const url = "libsql://5gindonesia-onlyhasbi.aws-ap-northeast-1.turso.io";
const authToken =
  "REDACTED_TURSO_TOKEN";

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
