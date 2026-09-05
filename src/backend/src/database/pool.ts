import pg from "pg";
import { loadConfig } from "../config.js";

// node-postgres returns BIGINT (int8) columns as strings to avoid precision loss.
// All identifiers in this schema fit safely in a JS number, so normalize them
// so downstream code and the API always see consistent numeric id/role types.
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (_pool) return _pool;
  const config = loadConfig();
  _pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 20 });
  _pool.on("error", (err) => {
    console.error("Unexpected pool error", err);
  });
  return _pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
