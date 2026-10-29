// D1-compatible adapter on top of Postgres (Supabase).
// The original route handlers call getDb().prepare(sql).bind(...).first/all/run and db.batch([...])
// with SQLite SQL. This adapter keeps that API and translates the few SQLite-specific constructs
// used by FamilyFlow into Postgres SQL, so the route code itself stays unchanged.

export type QueryResult = { rows: Record<string, unknown>[]; count: number }
export type Executor = {
  query(sql: string, params: unknown[]): Promise<QueryResult>
  transaction<T>(fn: (query: Executor['query']) => Promise<T>): Promise<T>
  /** Optional: mehrere Anweisungen atomar in einem Aufruf (z. B. per RPC) ausführen. */
  batch?(statements: { sql: string; params: unknown[] }[]): Promise<QueryResult[]>
}

/**
 * Zerlegt Postgres-SQL mit $n-Platzhaltern (außerhalb von Literalen) in feste SQL-Teile und
 * Parameterverweise. Die Datenbankfunktion public.familyflow_exec setzt die Werte serverseitig
 * mit quote_literal() zwischen die Teile ein (ein Durchgang, kein erneutes Durchsuchen der Werte).
 */
export function splitPlaceholders(sql: string): { parts: string[]; refs: number[] } {
  const parts: string[] = []
  const refs: number[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") quoted = !quoted
    if (ch === '$' && !quoted && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1
      while (/[0-9]/.test(sql[j] || '')) j++
      parts.push(current); current = ''
      refs.push(Number(sql.slice(i + 1, j)) - 1)
      i = j - 1
    } else current += ch
  }
  parts.push(current)
  return { parts, refs }
}

/** Executor über die RPC-Funktion public.familyflow_exec (siehe supabase/rpc.sql). */
export function rpcExecutor(call: (statements: { parts: string[]; refs: number[]; params: unknown[] }[]) => Promise<QueryResult[]>): Executor {
  const toStatement = (sql: string, params: unknown[]) => ({ ...splitPlaceholders(sql), params })
  return {
    async query(sql, params) { return (await call([toStatement(sql, params)]))[0] },
    async transaction() { throw new Error('Transaktionen laufen über batch()') },
    batch(statements) { return call(statements.map(s => toStatement(s.sql, s.params))) },
  }
}

const cache = new Map<string, string>()

/** Translate the SQLite dialect used by FamilyFlow into Postgres. */
export function translateSql(input: string): string {
  const hit = cache.get(input)
  if (hit) return hit
  let sql = input
  // Parameters inside a CTE select list need an explicit type in Postgres.
  sql = sql.replace(/SELECT \? AS id\)/g, 'SELECT ?::text AS id)')
  // strftime('%Y-%m-%dT%H:%M:%fZ', 'now') -> ISO timestamp with milliseconds (UTC)
  sql = sql.replace(/strftime\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/g, `to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
  // json_each(col) -> set-returning function with a "value" column
  sql = sql.replace(/json_each\(([\w.]+)\)/g, (_m, col) => `json_array_elements_text((${col})::json) AS je(value)`)
  // SUM(<boolean expression>) -> SUM((<expr>)::int)
  sql = sql.replace(/SUM\(([\w.]+\s*(?:=\s*'[^']*'|IN\s*\([^)]*\)))\)/g, (_m, expr) => `SUM((${expr})::int)`)
  // SQLite sorts NULL first in ascending order, Postgres last.
  sql = sql.replace(/ORDER BY ((?:\w+\.)?date), ((?:\w+\.)?time)\b(?!\s+NULLS)/g, 'ORDER BY $1, $2 NULLS FIRST')
  // INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING')
  }
  // ? placeholders -> $1, $2, ... (FamilyFlow SQL never contains ? inside string literals)
  let index = 0
  let out = ''
  let quoted = false
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted
    if (ch === '?' && !quoted) { index += 1; out += `$${index}` } else out += ch
  }
  cache.set(input, out)
  return out
}

function normalizeParam(value: unknown) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

class Statement {
  constructor(private readonly db: D1OnPostgres, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.db, this.sql, params) }
  async all<T = Record<string, unknown>>() {
    const r = await this.db.exec(this.sql, this.params)
    return { results: r.rows as T[], success: true, meta: { changes: r.count } }
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const r = await this.db.exec(this.sql, this.params)
    const row = r.rows[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }
  async run() {
    const r = await this.db.exec(this.sql, this.params)
    return { success: true, results: r.rows, meta: { changes: r.count } }
  }
  async raw() { const r = await this.db.exec(this.sql, this.params); return r.rows.map(row => Object.values(row)) }
}

export class D1OnPostgres {
  constructor(private readonly executor: Executor) {}
  exec(sql: string, params: unknown[]) {
    return this.executor.query(translateSql(sql), params.map(normalizeParam))
  }
  prepare(sql: string) { return new Statement(this, sql) }
  async batch(statements: Statement[]) {
    if (this.executor.batch) {
      const results = await this.executor.batch(statements.map(s => ({ sql: translateSql(s.sql), params: s.params.map(normalizeParam) })))
      return results.map(r => ({ success: true, results: r.rows, meta: { changes: r.count } }))
    }
    return this.executor.transaction(async (query) => {
      const results = []
      for (const s of statements) {
        const r = await query(translateSql(s.sql), s.params.map(normalizeParam))
        results.push({ success: true, results: r.rows, meta: { changes: r.count } })
      }
      return results
    })
  }
}
