"use client"

import { useMemo, useState } from "react"
import type { QverisExecuteResponse, QverisTool } from "@/lib/qveris"

export function ToolCard({
  index,
  tool,
  searchId,
  sessionId,
}: {
  index: number
  tool: QverisTool
  searchId: string
  sessionId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [paramsText, setParamsText] = useState(() =>
    JSON.stringify(tool.examples?.sample_parameters ?? sampleFromParams(tool), null, 2),
  )
  const [calling, setCalling] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)
  const [callResult, setCallResult] = useState<QverisExecuteResponse | null>(null)

  const successRate = useMemo(
    () => (typeof tool.stats?.success_rate === "number" ? Math.round(tool.stats.success_rate * 100) : null),
    [tool.stats?.success_rate],
  )

  async function runCall() {
    setCalling(true)
    setCallError(null)
    setCallResult(null)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(paramsText) as Record<string, unknown>
    } catch (e) {
      setCallError("参数 JSON 解析失败：" + (e instanceof Error ? e.message : ""))
      setCalling(false)
      return
    }
    try {
      const res = await fetch("/api/qveris/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_id: tool.tool_id,
          search_id: searchId,
          session_id: sessionId,
          parameters: parsed,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setCallResult(json as QverisExecuteResponse)
    } catch (err) {
      setCallError(err instanceof Error ? err.message : "调用失败")
    } finally {
      setCalling(false)
    }
  }

  return (
    <li className={`rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 ${expanded ? "2xl:col-span-2" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] text-ink-faint">{String(index).padStart(2, "0")}</span>
          <h3 className="truncate text-[17px] font-semibold text-ink">{tool.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
          {tool.region ? <span>{tool.region}</span> : null}
          {successRate !== null ? <span>成功率 {successRate}%</span> : null}
          {typeof tool.stats?.avg_execution_time_ms === "number" ? (
            <span>{Math.round(tool.stats.avg_execution_time_ms)}ms</span>
          ) : null}
        </div>
      </div>

      <p className="mt-1 font-mono text-[11px] text-ink-muted">{tool.tool_id}</p>
      {tool.provider_name ? (
        <p className="mt-0.5 text-xs text-ink-muted">提供方 · {tool.provider_name}</p>
      ) : null}

      <p className="mt-3 text-[13px] leading-6 text-ink-muted">{tool.description}</p>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 h-8 rounded-[6px] border border-rule bg-white px-3 font-mono text-[11px] text-ink hover:border-ink"
      >
        {expanded ? "收起" : "展开参数与试调用"}
      </button>

      {expanded ? (
        <div className="mt-4 space-y-5 rounded-[7px] border border-rule bg-white px-3 py-3">
          {tool.params && tool.params.length > 0 ? (
            <div>
              <div className="font-mono text-[11px] text-ink-muted">
                参数 Schema
              </div>
              <div className="mt-2 grid gap-2 md:hidden">
                {tool.params.map((p) => (
                  <div key={p.name} className="rounded-[6px] border border-rule bg-[#fafafa] px-2.5 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <span className="break-all font-mono text-[12px] text-ink">{p.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-muted">{p.type}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                      {p.required ? "必填 · " : ""}
                      {p.description}
                    </p>
                    {p.enum?.length ? (
                      <p className="mt-1 break-all font-mono text-[10px] text-ink-faint">{p.enum.join(" | ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="mt-2 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs text-ink-muted">
                    <th className="py-1.5 pr-3 font-normal">名称</th>
                    <th className="py-1.5 pr-3 font-normal">类型</th>
                    <th className="py-1.5 pr-3 font-normal">必填</th>
                    <th className="py-1.5 font-normal">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.params.map((p) => (
                    <tr key={p.name} className="border-b border-rule/60 align-top">
                      <td className="py-1.5 pr-3 font-mono text-[12px] text-ink">{p.name}</td>
                      <td className="py-1.5 pr-3 font-mono text-[12px] text-ink-muted">{p.type}</td>
                      <td className="py-1.5 pr-3 font-mono text-[12px] text-ink-muted">
                        {p.required ? "是" : "—"}
                      </td>
                      <td className="py-1.5 text-ink-soft">
                        {p.description}
                        {p.enum?.length ? (
                          <span className="ml-1 font-mono text-[11px] text-ink-muted">
                            ({p.enum.join(" | ")})
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">该工具无参数。</p>
          )}

          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] text-ink-muted">
                参数 JSON
              </span>
              <span className="text-[11px] text-ink-muted">注：调用会消耗 credit</span>
            </div>
            <textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              spellCheck={false}
              rows={Math.min(12, Math.max(4, paramsText.split("\n").length))}
              className="mt-2 block w-full resize-y rounded-[7px] border border-rule bg-[#fafafa] p-3 font-mono text-[12px] text-ink focus:border-ink focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={runCall}
                disabled={calling}
                className="h-9 rounded-[7px] border border-ink px-4 font-mono text-[12px] text-ink hover:bg-ink hover:text-paper disabled:opacity-30"
              >
                {calling ? "调用中…" : "试调用"}
              </button>
              {callResult ? (
                <span className="font-mono text-[11px] text-ink-muted">
                  {callResult.success ? "成功" : "失败"} ·{" "}
                  {typeof callResult.elapsed_time_ms === "number"
                    ? `${Math.round(callResult.elapsed_time_ms)}ms`
                    : ""}
                  {typeof callResult.cost === "number" ? ` · ${callResult.cost} credits` : ""}
                </span>
              ) : null}
            </div>
          </div>

          {callError ? (
            <div className="rounded-[7px] border border-bull/40 bg-bull/5 px-4 py-3 text-sm text-bull">
              {callError}
            </div>
          ) : null}

          {callResult ? (
            <div>
              <div className="font-mono text-[11px] text-ink-muted">
                响应
              </div>
              <pre className="mt-2 max-h-[420px] overflow-auto rounded-[7px] border border-rule bg-[#fafafa] p-3 font-mono text-[11.5px] leading-relaxed text-ink">
                {JSON.stringify(callResult, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function sampleFromParams(tool: QverisTool): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of tool.params ?? []) {
    if (!p.required) continue
    if (p.enum?.length) {
      out[p.name] = p.enum[0]
      continue
    }
    switch (p.type) {
      case "number":
        out[p.name] = 0
        break
      case "boolean":
        out[p.name] = false
        break
      case "array":
        out[p.name] = []
        break
      case "object":
        out[p.name] = {}
        break
      default:
        out[p.name] = ""
    }
  }
  return out
}
