// Basis-Pfad der App (GitHub Pages: "/familyflow/"). Wird vom Vite-Build über import.meta.env.BASE_URL gesetzt.
const base: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/"
export const APP_BASE = base.endsWith("/") ? base : `${base}/`
/** Wandelt einen Pfad relativ zur App-Wurzel ("/branding/x.png") in den Pfad unter dem Basis-Pfad um. */
export const appPath = (path: string) => `${APP_BASE}${path.replace(/^\//, "")}`
