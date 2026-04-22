import { randomUUID } from "node:crypto";
import { db } from "../src/db/db";

async function setupAdmin() {
  const args = Bun.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: bun run scripts/setup-admin.ts <username> <password>",
    );
    process.exit(1);
  }

  const username = args[0];
  const password = args[1];

  console.log(`Setting up super admin '${username}'...`);

  try {
    const hashedPassword = await Bun.password.hash(password);
    const id = randomUUID();

    await db.execute({
      sql: `INSERT INTO admins (id, username, katasandi_hash) VALUES (?, ?, ?)`,
      args: [id, username, hashedPassword],
    });
  } catch (error: any) {
    if (error.message?.includes("UNIQUE constraint failed")) {
      console.error(
        "❌ Error: Username tersebut sudah terdaftar sebagai super admin.",
      );
    } else {
      console.error("❌ Error:", error.message);
    }
  }
}

setupAdmin();
