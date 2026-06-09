import { NextRequest, NextResponse } from "next/server"

const DEFAULT_API_URL = "http://localhost:8000"

export async function middleware(request: NextRequest) {
  if (!isAuthRequired()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()
  if (isAuthorizedCronApi(request)) return NextResponse.next()

  const cookie = request.headers.get("cookie")
  if (!cookie) return unauthorized(request, pathname, search)

  const apiBaseUrl = process.env.PYTHON_API_URL ?? DEFAULT_API_URL
  const authenticated = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/session`, {
    headers: {
      accept: "application/json",
      cookie,
    },
    cache: "no-store",
  }).then((response) => response.ok).catch(() => false)

  if (!authenticated) return unauthorized(request, pathname, search)
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"],
}

function isAuthRequired() {
  return process.env.WEB_AUTH_REQUIRED !== "false"
}

function isPublicPath(pathname: string) {
  return pathname === "/login" ||
    pathname === "/api/control/auth/login" ||
    pathname === "/api/control/auth/session"
}

function isAuthorizedCronApi(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (!pathname.startsWith("/api/")) return false
  const secret = process.env.CRON_SECRET
  if (!secret || secret === "change-me") return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

function unauthorized(request: NextRequest, pathname: string, search: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  return redirectToLogin(request, pathname, search)
}

function redirectToLogin(request: NextRequest, pathname: string, search: string) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = "/login"
  loginUrl.search = ""
  loginUrl.searchParams.set("next", `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}
