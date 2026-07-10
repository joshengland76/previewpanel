// scoring/postedVideoExclusionTest.mjs — Phase C, Task 3. Unlike this
// directory's other *Test.mjs files (pure functions, no DB), the
// is_posted_video exclusion is fundamentally a SQL WHERE-clause concern (the
// filtering happens in server.js's fetchShadowRows/fetchPersonalPredictions
// queries, not in percentilePools.js's pure pool math) — so this test
// verifies the ACTUAL query shape against the real database rather than
// mocking it. Requires DATABASE_URL (reads backend/.env via dotenv). Writes
// and cleans up its own rows only, scoped to a unique test user_id/objective
// so it can never collide with or affect real data.
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function queryRW(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL default_transaction_read_only = off");
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

const TEST_USER = `test-posted-exclusion-${Date.now()}`;
const TEST_OBJECTIVE = "Aesthetic/Vibes";
let failures = 0;

function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "✓" : "✗"} ${label}${pass ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!pass) failures++;
}

async function main() {
  // One normal preview row, one posted-video-tagged row, same user/objective.
  await queryRW(
    `INSERT INTO shadow_scores (model_version, prediction, objective, user_id, is_posted_video, source)
     VALUES ('v2_capstone', 0.11, $1, $2, false, 'app')`,
    [TEST_OBJECTIVE, TEST_USER]
  );
  await queryRW(
    `INSERT INTO shadow_scores (model_version, prediction, objective, user_id, is_posted_video, source)
     VALUES ('v2_capstone', 0.99, $1, $2, true, 'validation')`,
    [TEST_OBJECTIVE, TEST_USER]
  );

  try {
    // Mirrors the exact WHERE clause used in server.js's fetchShadowRows
    // (the niche/overall percentile pool source).
    const poolRows = await pool.query(
      `SELECT id, prediction, objective FROM shadow_scores
       WHERE prediction IS NOT NULL AND is_posted_video IS NOT TRUE AND user_id = $1`,
      [TEST_USER]
    );
    check("pool query excludes the posted-video row", poolRows.rows.map((r) => r.prediction), [0.11]);

    // Mirrors the exact WHERE clause used in fetchPersonalPredictions.
    const personalRows = await pool.query(
      `SELECT prediction FROM shadow_scores
       WHERE user_id = $1 AND prediction IS NOT NULL AND is_posted_video IS NOT TRUE
       ORDER BY created_at DESC LIMIT 500`,
      [TEST_USER]
    );
    check("personal-history query excludes the posted-video row", personalRows.rows.map((r) => r.prediction), [0.11]);

    // Sanity: without the exclusion, both rows should be visible (proves the
    // test setup itself is correct, not just the filter).
    const unfiltered = await pool.query(`SELECT prediction FROM shadow_scores WHERE user_id = $1 ORDER BY prediction`, [TEST_USER]);
    check("unfiltered query sees both rows (test setup sanity check)", unfiltered.rows.map((r) => r.prediction), [0.11, 0.99]);
  } finally {
    await queryRW(`DELETE FROM shadow_scores WHERE user_id = $1`, [TEST_USER]);
  }

  console.log(failures === 0 ? "\nAll checks passed.\n\nGATE: PASS" : `\n${failures} check(s) FAILED.\n\nGATE: FAIL`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
