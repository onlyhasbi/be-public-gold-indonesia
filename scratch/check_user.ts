import { createClient } from "@libsql/client";

const db = createClient({
  url: "file:local.db",
});

async function checkUser() {
  const pgcode = "PG01817025";
  const res = await db.execute({
    sql: "SELECT id, pgcode, email, role, is_active FROM users WHERE UPPER(pgcode) = UPPER(?)",
    args: [pgcode],
  });

  process.exit(0);
}

checkUser().catch((err) => {
  console.error(err);
  process.exit(1);
});
