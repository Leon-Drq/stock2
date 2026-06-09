import { NextRequest, NextResponse } from "next/server"

const DEFAULT_API_URL = "http://localhost:8000"

export async function middleware(request: NextRequest) {
  if (!isAuthRequired()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()

  const cookie = request.headers.get("cookie")
  if (!cookie) return redirectToLogin(request, pathname, search)

  const apiBaseUrl = process.env.PYTHON_API_URL ?? DEFAULT_API_URL
  const authenticated = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/session`, {
    headers: {
      accept: "application/json",
      cookie,
    },
    cache: "no-store",
  }).then((response) => response.ok).catch(() => false)

  if (!authenticated) return redirectToLogin(request, pathname, search)
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\..*).*)"],
}

function isAuthRequired() {
  return process.env.WEB_AUTH_REQUIRED !== "false"
}

function isPublicPath(pathname: string) {
  return pathname === "/login"
}

function redirectToLogin(request: NextRequest, pathname: string, search: string) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = "/login"
  loginUrl.search = ""
  loginUrl.searchParams.set("next", `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}
