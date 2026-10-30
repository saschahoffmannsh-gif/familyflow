// Statischer Build für GitHub Pages (https://saschahoffmannsh-gif.github.io/familyflow/).
// Aufruf: pnpm build:pages  – Ausgabe in dist-pages/ (inkl. 404.html als SPA-Fallback).
import { copyFileSync } from "node:fs"
import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const root = import.meta.dirname
// Öffentliche Adresse der Supabase Edge Function (kein Geheimnis).
process.env.VITE_API_BASE ||= "https://vzjcwnuylyoufrvulgcl.supabase.co/functions/v1/familyflow"
process.env.VITE_API_REGION ||= "eu-central-1"
export default defineConfig({
  root: path.join(root, "web"),
  base: process.env.PAGES_BASE || "/familyflow/",
  publicDir: path.join(root, "public"),
  plugins: [react(), {
    name: "spa-404-fallback",
    closeBundle() { copyFileSync(path.join(root, "dist-pages/index.html"), path.join(root, "dist-pages/404.html")) },
  }],
  resolve: { alias: { "@": root } },
  build: { outDir: path.join(root, "dist-pages"), emptyOutDir: true },
})
