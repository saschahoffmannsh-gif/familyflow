import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Done",
  description: "Dein persönlicher Kalender für Familie, Team und Arbeit.",
  applicationName: "Done",
  referrer: "no-referrer",
  manifest: "/manifest.webmanifest?v=done-v4",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Done",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/branding/done-v3-favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/branding/done-v3-icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: "/branding/done-v3-favicon-32.png",
    apple: [{ url: "/branding/done-v3-apple-180.png", sizes: "180x180", type: "image/png" }],
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f3f8",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
