import type { Metadata } from "next"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"

const showVercelAnalytics = process.env.VERCEL === "1"

export const metadata: Metadata = {
  title: "股票雷达 — A 股研究简报",
  description: "每日一份 A 股研究简报，聚焦买点、风险与赔率。",
  generator: "v0.app",
  icons: {
    icon: "/icon.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="bg-background">
      <body className="font-sans antialiased">
        {children}
        {showVercelAnalytics && <Analytics />}
      </body>
    </html>
  )
}
