// Tiny data layer: a real SQLite database (sql.js / WebAssembly) running in the browser.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import schemaSql from './schema.sql?raw';
import seedSql from './seed.sql?raw';

let db = null;

export async function openDatabase() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  db = new SQL.Database();
  db.run(schemaSql);
  db.run(seedSql);
  return db;
}

/** Run a query and return { rows, columns, sql, ms } */
export function query(sql, params = []) {
  const t0 = performance.now();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  const columns = stmt.getColumnNames();
  stmt.free();
  return { rows, columns, sql: inline(sql, params), ms: performance.now() - t0 };
}

/** Free-form console: runs any SQL (possibly several statements). */
export function runConsole(sql) {
  const t0 = performance.now();
  const results = db.exec(sql);
  const ms = performance.now() - t0;
  const last = results[results.length - 1];
  if (!last) return { columns: [], rows: [], ms, changes: db.getRowsModified() };
  const rows = last.values.map((v) => Object.fromEntries(last.columns.map((c, i) => [c, v[i]])));
  return { columns: last.columns, rows, ms };
}

export function resetDatabase() {
  db.close();
  return openDatabase();
}

function inline(sql, params) {
  let i = 0;
  return sql
    .replace(/\?/g, () => {
      const v = params[i++];
      return typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v);
    })
    .replace(/\s+\n/g, '\n')
    .trim();
}

// ---------- App queries ----------

const SORTS = {
  power: 'power_hp', torque: 'torque_nm', speed: 'top_speed_kmh', accel: 'zero_100_s',
  year: 'year', weight: 'weight_kg', price: 'price_usd', ratio: 'hp_per_tonne', name: 'model',
};

export function listCars(f = {}) {
  const where = [];
  const params = [];
  if (f.search) { where.push('(model LIKE ? OR manufacturer LIKE ?)'); params.push(`%${f.search}%`, `%${f.search}%`); }
  if (f.manufacturer) { where.push('manufacturer = ?'); params.push(f.manufacturer); }
  if (f.layout) { where.push('engine_layout = ?'); params.push(f.layout); }
  if (f.position) { where.push('engine_position = ?'); params.push(f.position); }
  if (f.drivetrain) { where.push('drivetrain = ?'); params.push(f.drivetrain); }
  if (f.minPower) { where.push('power_hp >= ?'); params.push(Number(f.minPower)); }
  if (f.fromYear) { where.push('year >= ?'); params.push(Number(f.fromYear)); }
  const col = SORTS[f.sort] || 'power_hp';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT slug, model, manufacturer, year, engine_layout, engine_position,
       drivetrain, power_hp, torque_nm, top_speed_kmh, zero_100_s, hp_per_tonne
FROM car_overview${where.length ? `\nWHERE ${where.join('\n  AND ')}` : ''}
ORDER BY ${col} ${dir};`;
  return query(sql, params);
}

export function getCar(slug) {
  return query('SELECT * FROM car_overview WHERE slug = ?;', [slug]).rows[0];
}

export function getAllCars() {
  return query('SELECT * FROM car_overview ORDER BY id;').rows;
}

export function getParts(slug) {
  const r = query(
    `SELECT p.key, p.name, p.system, p.description, cp.spec
FROM car_parts cp
JOIN part_types p ON p.key = cp.part_key
JOIN cars c       ON c.id = cp.car_id
WHERE c.slug = ?;`, [slug]);
  return Object.fromEntries(r.rows.map((row) => [row.key, row]));
}

export function distinct(column) {
  const allowed = ['manufacturer', 'engine_layout', 'engine_position', 'drivetrain'];
  if (!allowed.includes(column)) return [];
  return query(`SELECT DISTINCT ${column} AS v FROM car_overview ORDER BY v;`).rows.map((r) => r.v);
}

export function compareCars(a, b) {
  return query(
    `SELECT slug, manufacturer, model, power_hp, torque_nm, top_speed_kmh, zero_100_s,
       weight_kg, hp_per_tonne, price_usd, engine_layout, drivetrain
FROM car_overview
WHERE slug IN (?, ?);`, [a, b]);
}

export function maxStats() {
  return query(`SELECT MAX(power_hp) AS power, MAX(torque_nm) AS torque, MAX(top_speed_kmh) AS speed,
       MIN(zero_100_s) AS accel_best, MAX(zero_100_s) AS accel_worst, MAX(weight_kg) AS weight,
       MAX(hp_per_tonne) AS ratio FROM car_overview;`).rows[0];
}

export function credits() {
  return query(`SELECT a.kind, a.title, a.author, a.license, a.source, a.url, c.model AS car
FROM assets a
LEFT JOIN cars c ON c.id = a.car_id
ORDER BY a.kind, c.id;`);
}
