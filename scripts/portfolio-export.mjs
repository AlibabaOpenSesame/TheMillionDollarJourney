import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../data/export/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const manifest = await read('manifest.json');
const keys = {
  portfolio_snapshots: ['as_of'],
  portfolio_positions: ['as_of', 'contract_key'],
  fx_rates: ['pair'],
  sync_runs: ['id'],
};
assert.deepEqual(Object.keys(manifest.tables).sort(), Object.keys(keys).sort());
const tables = {};
for (const [name, primary] of Object.entries(keys)) {
  const spec = manifest.tables[name];
  const rows = await read(`${name}.json`);
  assert.equal(rows.length, spec.rows, `${name}: row count`);
  const seen = new Set();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...spec.columns].sort(), `${name}: columns`);
    const key = JSON.stringify(primary.map((column) => {
      assert.notEqual(row[column], null, `${name}: null key`);
      return row[column];
    }));
    assert(!seen.has(key), `${name}: duplicate key ${key}`);
    seen.add(key);
    for (const [column, value] of Object.entries(row)) {
      assert(value === null || ['string', 'number'].includes(typeof value), `${name}.${column}: scalar required`);
      if (typeof value === 'number') assert(Number.isFinite(value));
      if (typeof value === 'string') {
        assert(!/gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|\bU\d{6,}\b|Bearer\s+\S+/i.test(value), `${name}.${column}: possible secret/account identifier`);
      }
    }
  }
  tables[name] = rows;
}
const dates = new Set(tables.portfolio_snapshots.map((row) => row.as_of));
assert.equal([...dates].sort().at(-1), manifest.latestAsOf);
for (const row of tables.portfolio_positions) assert(dates.has(row.as_of), 'Position without snapshot');
for (const row of tables.fx_rates) assert(row.rate > 0, 'Invalid FX rate');

if (process.argv.includes('--sql')) {
  const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
  const literal = (value) => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;
  console.log('-- Apply drizzle migrations before this point-in-time data seed.');
  console.log('PRAGMA foreign_keys = ON;\nBEGIN TRANSACTION;');
  for (const [name, primary] of Object.entries(keys)) {
    const columns = manifest.tables[name].columns;
    const updates = columns.filter((c) => !primary.includes(c)).map((c) => `${identifier(c)}=excluded.${identifier(c)}`).join(', ');
    for (const row of tables[name]) {
      console.log(`INSERT INTO ${identifier(name)} (${columns.map(identifier).join(', ')}) VALUES (${columns.map((c) => literal(row[c])).join(', ')}) ON CONFLICT (${primary.map(identifier).join(', ')}) DO UPDATE SET ${updates};`);
    }
  }
  console.log('COMMIT;');
} else {
  console.log(JSON.stringify({ valid: true, latestAsOf: manifest.latestAsOf, counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])) }, null, 2));
}
