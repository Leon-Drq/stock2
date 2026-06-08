"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

export function RefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [refreshing, setRefreshing] = useState(false)

  async function handleClick() {
    setRefreshing(true)
    try {
      await fetch("/api/data-health/refresh", { method: "POST" })
      startTransition(() => router.refresh())
    } finally {
      setRefreshing(false)
    }
  }

  const busy = isPending || refreshing
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 border border-rule px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft transition-colors hover:bg-paper-warm disabled:opacity-50"
    >
      <span className={`size-1.5 rounded-full ${busy ? "animate-pulse bg-health-warn" : "bg-health-ok"}`} aria-hidden />
      {busy ? "采样中…" : "重新采样"}
    </button>
  )
}
