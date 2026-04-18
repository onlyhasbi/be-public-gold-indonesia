import { getSetting } from "../utils/settings";
import { setupDatabase } from "../db/db";

async function check() {
  console.log("--- Diagnostic Check ---");
  console.log("ENV SECRET_CODE:", Bun.env.SECRET_CODE || "(not set)");

  try {
    await setupDatabase();
    const dbSecret = await getSetting("portal_secret_code");
    const autoRotate = await getSetting("portal_secret_auto_rotate");

    console.log(
      "DB portal_secret_code:",
      dbSecret === null ? "NULL" : `"${dbSecret}"`,
    );
    console.log(
      "DB portal_secret_auto_rotate:",
      autoRotate === null ? "NULL" : `"${autoRotate}"`,
    );

    const rawSecret = dbSecret || Bun.env.SECRET_CODE || "unlimited";
    const normalizedSecret = rawSecret.replace(/\s+/g, "").toLowerCase();

    console.log("Resolved Secret (Normalized):", `"${normalizedSecret}"`);
  } catch (err) {
    console.error("Diagnostic failed:", err);
  }
  process.exit(0);
}

check();
