# Hosting: GitHub Pages + Supabase

- **Frontend**: statischer Vite-Build (`pnpm build:pages`, Basis `/familyflow/`, SPA-Fallback `404.html`), deployt per GitHub Actions (`.github/workflows/pages.yml`) nach https://saschahoffmannsh-gif.github.io/familyflow/
- **Backend**: Supabase Edge Function `familyflow` (Projekt `wlujgkbtpjxuekwsgnmg`, `--no-verify-jwt`). Die Original-API-Routen aus `app/api/**` werden unverändert per esbuild gebündelt (`pnpm build:function`).
- **Datenbank**: Postgres-Schema `familyflow` (`supabase/schema.sql`, `supabase/seed.sql`, `supabase/rpc.sql`). Ein D1-kompatibler Adapter (`server/d1-postgres.ts`) übersetzt die SQLite-Abfragen und führt sie über die RPC `public.familyflow_exec` (nur `service_role`) aus.
- **Dateien**: privater Storage-Bucket `familyflow-media` statt R2.
- **Push**: neue VAPID-Schlüssel; der private Schlüssel, `PROFILE_CHANGE_CODE` und `DAILY_PUSH_TOKEN` liegen nur als Function-Secrets vor. Täglicher Push um 07:00 (Berlin) per `pg_cron`.

Deploy der Function: `pnpm deploy:function` (benötigt `SUPABASE_ACCESS_TOKEN` in der Umgebung).

Tests: `pnpm test` (Original-Tests + Postgres via PGlite), `pnpm test:live` (API-Smoke gegen die Function), `pnpm test:e2e` (Chrome-E2E gegen die Pages-URL).
