"use client"

import { useState } from "react"
import type { QverisSearchResponse, QverisTool } from "@/lib/qveris"
import { ToolCard } from "./tool-card"

const PRESETS = [
  "A股股票实时行情",
  "A股个股分时数据",
  "A股股票日K线历史数据",
  "A股股票财务指标",
  "A股板块涨跌排行",
  "A股新闻舆情",
  "A股龙虎榜数据",
  "上证指数实时行情",
]

export function DiscoverClient() {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<QverisSearchResponse | null>(null)
  const [sessionId] = useState(() => `probe-${Math.random().toString(36).slice(2, 10)}`)

  async function runDiscover(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch("/api/qveris/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, session_id: sessionId, limit: 12 }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setData(json as QverisSearchResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          runDiscover(query)
        }}
        className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5"
      >
        <label className="block">
          <span className="font-mono text-[11px] text-ink-muted">
            自然语言查询
          </span>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：A股股票实时行情"
              className="h-10 flex-1 rounded-[7px] border border-rule bg-[#fafafa] px-3 text-[14px] text-ink placeholder:text-ink-muted/60 focus:border-ink focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="h-10 rounded-[7px] bg-ink px-4 font-mono text-[12px] text-white hover:bg-ink-soft disabled:opacity-30"
            >
              {loading ? "搜索中" : "搜索"}
            </button>
          </div>
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex h-8 items-center font-mono text-[11px] text-ink-muted">
            预设
          </span>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setQuery(p)
                runDiscover(p)
              }}
              className="h-8 rounded-[6px] border border-rule bg-[#fafafa] px-3 text-[12px] text-ink-muted hover:text-ink"
            >
              {p}
            </button>
          ))}
        </div>
      </form>

      {error ? (
        <div className="rounded-[7px] border border-bull/40 bg-bull/5 px-5 py-4 text-sm text-bull">
          <div className="font-mono text-[11px]">错误</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : null}

      {data ? (
        <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule-soft pb-3">
            <h2 className="text-[18px] font-semibold text-ink">
              检索结果 <span className="font-mono text-sm text-ink-muted">{data.total}</span>
            </h2>
            <div className="font-mono text-[11px] text-ink-muted">
              search_id <span className="text-ink-soft">{data.search_id.slice(0, 12)}…</span>
              {typeof data.elapsed_time_ms === "number" ? (
                <span className="ml-3">{Math.round(data.elapsed_time_ms)}ms</span>
              ) : null}
            </div>
          </header>

          {data.results.length === 0 ? (
            <div className="py-8 text-ink-soft">未匹配到任何工具，请换一种说法。</div>
          ) : (
            <ol className="mt-4 grid gap-3 2xl:grid-cols-2">
              {data.results.map((tool: QverisTool, i) => (
                <ToolCard
                  key={tool.tool_id}
                  index={i + 1}
                  tool={tool}
                  searchId={data.search_id}
                  sessionId={sessionId}
                />
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  )
}
