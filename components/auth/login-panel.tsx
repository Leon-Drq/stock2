"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogIn, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function LoginPanel() {
  const router = useRouter()
  const [email, setEmail] = useState("admin@example.com")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function login() {
    setLoading(true)
    setError("")
    const response = await fetch("/api/control/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    if (!response.ok) {
      setError(await errorMessage(response, "登录失败"))
      setLoading(false)
      return
    }

    const next = new URLSearchParams(window.location.search).get("next")
    router.replace(isSafeNextPath(next) ? next : "/")
    router.refresh()
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f6] px-4 text-ink">
      <section className="w-full max-w-[420px] rounded-[7px] border border-rule bg-white px-5 py-5 shadow-sm">
        <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
          <ShieldCheck className="size-4" aria-hidden />
          Stock Radar
        </div>
        <h1 className="mt-2 text-[24px] font-semibold text-ink">登录</h1>
        <div className="mt-5 grid gap-3">
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" />
          <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="password" type="password" />
          <Button onClick={login} disabled={!email || !password || loading}>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
            登录
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-[#9f2d20]">{error}</p>}
      </section>
    </main>
  )
}

function isSafeNextPath(value: string | null): value is string {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"))
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail ?? fallback
  } catch {
    return fallback
  }
}
