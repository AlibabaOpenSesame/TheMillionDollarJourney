import snapshots from "../data/v2-baseline/portfolio_snapshots.json";
import positions from "../data/v2-baseline/portfolio_positions.json";
import runs from "../data/v2-baseline/sync_runs.json";
import rates from "../data/v2-baseline/fx_rates.json";
import { withLock } from "./live-service";

/** Idempotent isolated-v2 bootstrap. Never accepts table names or SQL from a request. */
export async function seedV2(db: D1Database) {
  return withLock(db, "v2-bootstrap", async () => {
    const seeded = await db.prepare("SELECT value FROM runtime_state WHERE key='v2-bootstrap'").first();
    if (seeded) return { seeded: false, reason: "already-imported" };
    const tables = { portfolio_snapshots: snapshots, portfolio_positions: positions, sync_runs: runs, fx_rates: rates };
    const statements: D1PreparedStatement[] = [];
    for (const [table, rows] of Object.entries(tables)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.every(c => /^[a-z_]+$/.test(c))) throw new Error("Invalid seed column");
        const values = Object.values(row);
        if (values.some(v => typeof v === "number" && !Number.isFinite(v))) throw new Error("Invalid seed amount");
        statements.push(db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...values));
      }
    }
    statements.push(db.prepare("INSERT INTO runtime_state (key,value,updated_at) VALUES ('v2-bootstrap','baseline-2026-09-18',?)").bind(new Date().toISOString()));
    await db.batch(statements);
    return { seeded: true, snapshots: snapshots.length, positions: positions.length };
  });
}
