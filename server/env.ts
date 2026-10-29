// Ersatz für `cloudflare:workers` in der Supabase Edge Function.
// Die Function setzt globalThis.__familyflowEnv (DB-Adapter, Speicher-Adapter, Secrets) beim Start.
type FamilyFlowEnv = { DB?: unknown; BUCKET?: unknown; VAPID_PRIVATE_KEY?: string; PROFILE_CHANGE_CODE?: string; DAILY_PUSH_TOKEN?: string }
const store = () => ((globalThis as unknown as { __familyflowEnv?: FamilyFlowEnv }).__familyflowEnv ||= {})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const env: any = new Proxy({}, { get: (_t, key: string) => (store() as Record<string, unknown>)[key] })
