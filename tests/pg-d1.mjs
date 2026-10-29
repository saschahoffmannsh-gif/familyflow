// Test-Datenbank für die Supabase/Postgres-Schicht: echtes Postgres (PGlite, im Arbeitsspeicher)
// mit dem erzeugten Schema (supabase/schema.sql + seed.sql) und dem D1-Adapter aus server/d1-postgres.ts.
// Kein Netzwerkzugriff, keine Live-Datenbank.
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const root=path.resolve(import.meta.dirname,'..')
function loadAdapter(){const js=ts.transpileModule(readFileSync(path.join(root,'server/d1-postgres.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,m={exports:{}};new Function('module','exports',js)(m,m.exports);return m.exports}
export async function createPgD1(){
 const pg=new PGlite({parsers:{20:Number,1700:Number}})
 const schema=readFileSync(path.join(root,'supabase/schema.sql'),'utf8').replace(/^revoke .*$/gm,'')
 await pg.exec(schema);await pg.exec(readFileSync(path.join(root,'supabase/seed.sql'),'utf8'));await pg.exec('SET search_path TO familyflow')
 const {D1OnPostgres,translateSql,rpcExecutor}=loadAdapter()
 // Wie in der Edge Function: alle Abfragen laufen über public.familyflow_exec (supabase/rpc.sql).
 // FF_TEST_DIRECT=1 nutzt stattdessen direkte Abfragen mit Parametern.
 await pg.exec('do $$ begin create role anon; create role authenticated; create role service_role; exception when duplicate_object then null; end $$;')
 await pg.exec(readFileSync(path.join(root,'supabase/rpc.sql'),'utf8'))
 const query=async(q,sql,params)=>{const r=await q.query(sql,params);return {rows:r.rows,count:r.affectedRows??r.rows.length}}
 const executor=process.env.FF_TEST_DIRECT?{query:(sql,params)=>query(pg,sql,params),transaction:fn=>pg.transaction(tx=>fn((sql,params)=>query(tx,sql,params)))}
  :rpcExecutor(async statements=>(await pg.query('select public.familyflow_exec($1::jsonb) as r',[JSON.stringify(statements)])).rows[0].r)
 const DB=new D1OnPostgres(executor)
 // Synchrone SQLite-Hilfen der alten Tests als asynchrone Variante (für Testvorbereitung/Prüfungen).
 const sqlite={prepare:sql=>({async get(...a){return (await pg.query(translateSql(sql),a)).rows[0]},async all(...a){return (await pg.query(translateSql(sql),a)).rows},async run(...a){const r=await pg.query(translateSql(sql),a);return {changes:r.affectedRows}}}),close:()=>pg.close()}
 return {DB,sqlite,pg}
}
