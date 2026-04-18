import { db } from "./db";

async function runBenchmark() {
  const searchTerm = "7890";
  const agentId = "placeholder"; // We can just do a dummy query or grab the first user's ID

  // Grab a valid user_id from leads to test properly
  const userRes = await db.execute("SELECT user_id FROM leads LIMIT 1");
  const actualAgentId =
    userRes.rows.length > 0 ? userRes.rows[0].user_id : "none";

  console.log("=== EXPLAIN QUERY PLAN ===");
  // 1. Traditional LIKE Query
  console.log("\\n1. Traditional (LIKE '%term%')");
  const explainLike = await db.execute({
    sql: "EXPLAIN QUERY PLAN SELECT id FROM leads WHERE user_id = ? AND (nama LIKE ? OR branch LIKE ? OR no_telpon LIKE ?)",
    args: [
      actualAgentId,
      `%${searchTerm}%`,
      `%${searchTerm}%`,
      `%${searchTerm}%`,
    ],
  });
  console.log(explainLike.rows);

  // 2. FTS5 Trigram MATCH
  console.log("\\n2. FTS5 Trigram MATCH");
  const explainFts = await db.execute({
    sql: "EXPLAIN QUERY PLAN SELECT l.id FROM leads l JOIN leads_fts fts ON l.id = fts.id WHERE l.user_id = ? AND leads_fts MATCH ?",
    args: [actualAgentId, `"${searchTerm}"`],
  });
  console.log(explainFts.rows);

  // Benchmarking Execution Time
  console.log("\\n=== EXECUTION TIME (100 iterations) ===");

  // Warmup
  await db.execute("SELECT 1");

  const ITERATIONS = 10;

  const startLike = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await db.execute({
      sql: "SELECT id, nama, branch, no_telpon FROM leads WHERE user_id = ? AND (nama LIKE ? OR branch LIKE ? OR no_telpon LIKE ?)",
      args: [
        actualAgentId,
        `%${searchTerm}%`,
        `%${searchTerm}%`,
        `%${searchTerm}%`,
      ],
    });
  }
  const endLike = performance.now();

  const startFts = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await db.execute({
      sql: "SELECT l.id, l.nama, l.branch, l.no_telpon FROM leads l JOIN leads_fts fts ON l.id = fts.id WHERE l.user_id = ? AND leads_fts MATCH ?",
      args: [actualAgentId, `"${searchTerm}"`],
    });
  }
  const endFts = performance.now();

  console.log(
    `Average TIME (LIKE): ${((endLike - startLike) / ITERATIONS).toFixed(2)} ms`,
  );
  console.log(
    `Average TIME (FTS5): ${((endFts - startFts) / ITERATIONS).toFixed(2)} ms`,
  );

  process.exit(0);
}

runBenchmark().catch(console.error);
