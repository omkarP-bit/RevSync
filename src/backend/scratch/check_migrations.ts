import "dotenv/config";
import { query } from "../src/database/pool.js";

async function check() {
  try {
    const res = await query(`SELECT name, run_on FROM pgmigrations ORDER BY id`);
    console.log("Recorded migrations:", res.rows);
  } catch (err) {
    console.error("Error querying pgmigrations:", err);
  }
  process.exit(0);
}

check();
