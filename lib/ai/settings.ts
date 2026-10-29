// Einstellungen für den KI-Import – nur lokal auf dem Gerät (localStorage), nie an den eigenen Server.
export type AiProviderId = 'openai' | 'gemini' | 'anthropic'
export type AiSettings = { provider: AiProviderId; model: string; apiKey: string; consent?: boolean }
export const AI_PROVIDERS: { id: AiProviderId; name: string; defaultModel: string; keyHint: string; keyUrl: string }[] = [
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-6-luna', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-3.5-flash-lite', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-haiku-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
]
export const AI_SETTINGS_KEY = 'done:ai-settings:v1'
export function providerInfo(id: AiProviderId) { return AI_PROVIDERS.find(p => p.id === id) || AI_PROVIDERS[0] }
export function loadAiSettings(storage: Pick<Storage, 'getItem'> = globalThis.localStorage): AiSettings | null {
  try {
    const raw = storage?.getItem(AI_SETTINGS_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<AiSettings>
    if (!v.apiKey || !AI_PROVIDERS.some(p => p.id === v.provider)) return null
    return { provider: v.provider!, model: v.model?.trim() || providerInfo(v.provider!).defaultModel, apiKey: v.apiKey, consent: !!v.consent }
  } catch { return null }
}
export function saveAiSettings(s: AiSettings, storage: Pick<Storage, 'setItem'> = globalThis.localStorage) { storage.setItem(AI_SETTINGS_KEY, JSON.stringify(s)) }
export function clearAiSettings(storage: Pick<Storage, 'removeItem'> = globalThis.localStorage) { storage.removeItem(AI_SETTINGS_KEY) }
