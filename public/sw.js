const CACHE_NAME = "done-v33-update-fix"
// GitHub Pages: die App liegt unter /familyflow/. Alle App-Pfade werden relativ zum Scope des Service Workers gebildet.
const SCOPE = new URL(self.registration.scope)
const scoped = (path) => {
  if (!path || !path.startsWith("/") || path.startsWith(SCOPE.pathname)) return path
  return SCOPE.pathname + path.slice(1)
}
const ROOT = scoped("/")
const APP_SHELL = [ROOT, scoped("/manifest.webmanifest?v=done-v1"), scoped("/manifest.webmanifest"), scoped("/branding/handoff-v1-logo-128.png"), scoped("/branding/handoff-v1-icon-192.png"), scoped("/branding/handoff-v1-icon-512.png"), scoped("/branding/handoff-v1-apple-180.png"), scoped("/branding/handoff-v1-favicon-32.png")]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(ROOT, copy))
          return response
        })
        .catch(() => caches.match(ROOT)),
    )
    return
  }

  if (new URL(request.url).pathname.startsWith(scoped("/api/"))) {
    event.respondWith(fetch(request))
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
      return response
    })),
  )
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "Done", body: event.data?.text() || "Es gibt etwas Neues." }
  }

  event.waitUntil(self.registration.showNotification(data.title || "Done", {
    body: data.body || "Es gibt etwas Neues.",
    icon: scoped(data.icon || "/branding/handoff-v1-icon-192.png"),
    badge: scoped(data.badge || "/branding/handoff-v1-icon-192.png"),
    tag: data.tag || "familyflow",
    data: { url: scoped(data.url || "/") },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || ROOT, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.registration.scope))
      if (existing) {
        existing.navigate(target)
        return existing.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
