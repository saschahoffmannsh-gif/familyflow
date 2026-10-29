// Bündelt die unveränderten API-Routen + D1-Adapter für die Supabase Edge Function (Deno).
// Ausgabe: supabase/functions/familyflow/routes.bundle.js
import { build } from 'esbuild'
import path from 'node:path'
import { existsSync } from 'node:fs'
const root = path.resolve(import.meta.dirname, '..')
await build({
  entryPoints: [path.join(root, 'server/routes.ts')],
  outfile: path.join(root, 'supabase/functions/familyflow/routes.bundle.js'),
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'], conditions: ['worker', 'browser', 'import'],
  banner: { js: '// Generiert von scripts/build-function.mjs – nicht von Hand bearbeiten.' },
  plugins: [{ name: 'familyflow-aliases', setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: path.join(root, 'server/env.ts') }))
    b.onResolve({ filter: /^@\// }, ({ path: spec }) => {
      const base = path.join(root, spec.slice(2))
      for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (existsSync(f) && /\.tsx?$/.test(f)) return { path: f }
    })
  } }],
  logLevel: 'info',
})
