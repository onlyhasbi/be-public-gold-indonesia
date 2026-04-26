import { createClient } from "@libsql/client";

async function sync() {
  const onlineUrl = process.env.TURSO_DATABASE_URL_ONLINE || "";
  const onlineToken = process.env.TURSO_AUTH_TOKEN;
  const localUrl = "file:local.db";

  if (!onlineToken) {
    console.error("❌ TURSO_AUTH_TOKEN tidak ditemukan di .env");
    return;
  }

  console.log("🌐 Menghubungkan ke Database Online...");
  const onlineDb = createClient({ url: onlineUrl, authToken: onlineToken });

  console.log("🏠 Menghubungkan ke Database Lokal...");
  const localDb = createClient({ url: localUrl });

  // Nonaktifkan foreign keys selama sinkronisasi
  await localDb.execute("PRAGMA foreign_keys = OFF");

  const tables = ["users", "leads", "analytics", "system_settings"];

  for (const table of tables) {
    console.log(`\n⏳ Sinkronisasi tabel: ${table}...`);

    try {
      // 1. Ambil data dari online
      const onlineRes = await onlineDb.execute(`SELECT * FROM ${table}`);
      const rows = onlineRes.rows;

      if (rows.length === 0) {
        console.log(`ℹ️ Tabel ${table} di online kosong.`);
        continue;
      }

      // 2. Bersihkan data lokal
      await localDb.execute(`DELETE FROM ${table}`);

      // 3. Masukkan data ke lokal
      const columns = onlineRes.columns;
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map((col) => row[col]);
        await localDb.execute({ sql, args: values as any });
      }

      console.log(
        `✅ Berhasil menyalin ${rows.length} baris ke tabel ${table}.`,
      );
    } catch (error: any) {
      console.error(
        `❌ Gagal sinkronisasi tabel ${table}:`,
        error?.message || error,
      );
    }
  }

  console.log("\n✨ Sinkronisasi selesai!");
  process.exit(0);
}

sync();
