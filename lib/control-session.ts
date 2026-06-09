import { NextResponse } from "next/server"

const DEFAULT_API_URL = "http://localhost:8000"

export async function requireAdminSession(request: Request) {
  if (process.env.WEB_AUTH_REQUIRED === "false") return null

  const cookie = request.headers.get("cookie")
  if (!cookie) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const apiBaseUrl = process.env.PYTHON_API_URL ?? DEFAULT_API_URL
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/session`, {
    headers: {
      accept: "application/json",
      cookie,
    },
    cache: "no-store",
  }).catch(() => null)

  if (!response?.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await response.json().catch(() => null) as { user?: { role?: string } } | null
  if (body?.user?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 })
  }

  return null
}
