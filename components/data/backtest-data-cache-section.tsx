"use client"

import { useEffect, useState } from "react"
import { BacktestDataCachePanel } from "@/components/data/backtest-data-cache-panel"
import type { BacktestDataStoreSnapshot } from "@/lib/backtest-data-store"

export function BacktestDataCacheSection() {
  const [snapshot, setSnapshot] = useState<BacktestDataStoreSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/backtest-data/status", { cache: "no-store" })
        const json = (await res.json()) as BacktestDataStoreSnapshot
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        setSnapshot(json)
      } catch (err) {
        setError(err instanceof Error ? err.message : "回测数据缓存状态加载失败")
      }
    }

    void load()
  }, [])

  if (!snapshot) {
    return (
      <>
        <BacktestDataCacheFallback />
        {error && (
          <p className="mt-3 rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
            {error}
          </p>
        )}
      </>
    )
  }

  return <BacktestDataCachePanel initial={snapshot} />
}

export function BacktestDataCacheFallback() {
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="h-5 w-40 animate-pulse bg-rule-soft" />
      <div className="mt-3 h-4 w-2/3 animate-pulse bg-rule-soft" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-[7px] border border-rule bg-[#fafafa]" />
        ))}
      </div>
    </section>
  )
}
