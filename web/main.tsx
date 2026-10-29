// Einstieg für den statischen GitHub-Pages-Build (ersetzt app/layout.tsx + app/page.tsx von Vinext).
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/app/globals.css"
import HomePage from "@/app/page"

// Die App ruft ihre API wie bisher unter "/api/..." auf. Auf GitHub Pages liegt die API in der
// Supabase Edge Function – relative API-Aufrufe werden deshalb dorthin umgeleitet.
// Die Function läuft fest in der Region der Datenbank (x-region), damit jede Abfrage kurze Wege hat.
const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "")
const API_REGION = String(import.meta.env.VITE_API_REGION || "")
if (API_BASE) {
  const nativeFetch = window.fetch.bind(window)
  const withRegion = (init?: RequestInit): RequestInit | undefined => {
    if (!API_REGION) return init
    const headers = new Headers(init?.headers)
    headers.set("x-region", API_REGION)
    return { ...init, headers }
  }
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api/")) return nativeFetch(`${API_BASE}${input}`, withRegion(init))
    if (input instanceof URL && input.origin === window.location.origin && input.pathname.startsWith("/api/")) return nativeFetch(`${API_BASE}${input.pathname}${input.search}`, withRegion(init))
    return nativeFetch(input, init)
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><HomePage /></StrictMode>)
