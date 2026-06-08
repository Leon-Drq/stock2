/**
 * Qveris.ai API client.
 *
 * Qveris is a capability router for AI agents. The flow is:
 *   1. discover(query)  — free, returns a list of matching tools with tool_id
 *   2. inspect(ids)     — free, get tool detail
 *   3. call(tool_id, params, search_id)  — billed, actually execute
 *
 * Docs: https://qveris.ai/docs/rest-api
 */

import { recordQverisUsage, type QverisCallMeta } from "@/lib/qveris-usage-store"

const BASE_URL = "https://qveris.ai/api/v1"
const DEFAULT_TIMEOUT_MS = 45_000

export type QverisToolParam = {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object"
  required: boolean
  description: string
  enum?: string[]
}

export type QverisTool = {
  tool_id: string
  name: string
  description: string
  provider_name?: string
  provider_description?: string
  region?: string
  params?: QverisToolParam[]
  examples?: { sample_parameters?: Record<string, unknown> }
  stats?: { avg_execution_time_ms?: number; success_rate?: number }
}

export type QverisSearchResponse = {
  search_id: string
  total: number
  results: QverisTool[]
  elapsed_time_ms?: number
}

export type QverisExecuteResponse<T = unknown> = {
  execution_id: string
  result: { data?: T; message?: string; truncated_content?: string; full_content_file_url?: string }
  success: boolean
  error_message?: string | null
  elapsed_time_ms?: number
  billing?: { summary?: string; list_amount_credits?: number }
  cost?: number
}

function getApiKey(): string {
  const key = process.env.QVERIS_API_KEY
  if (!key) {
    throw new Error("QVERIS_API_KEY 未配置")
  }
  return key
}

async function qverisFetch<T>(path: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const apiKey = getApiKey()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      // Server-side only; never expose key to client.
      cache: "no-store",
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Qveris ${path} ${res.status}: ${text.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Qveris ${path} timeout after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/** Step 1 — discover capabilities by natural language (free). */
export async function discover(query: string, sessionId?: string, limit = 10, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<QverisSearchResponse> {
  return qverisFetch<QverisSearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ query, limit, session_id: sessionId }),
  }, timeoutMs)
}

/** Step 3 — call a tool. Billed. */
export async function call<T = unknown>(
  toolId: string,
  searchId: string,
  parameters: Record<string, unknown>,
  sessionId?: string,
  maxResponseSize = 20480,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  meta?: QverisCallMeta,
): Promise<QverisExecuteResponse<T>> {
  const startedAt = new Date()
  const started = Date.now()
  try {
    const response = await qverisFetch<QverisExecuteResponse<T>>(`/tools/execute?tool_id=${encodeURIComponent(toolId)}`, {
      method: "POST",
      body: JSON.stringify({
        search_id: searchId,
        session_id: sessionId,
        parameters,
        max_response_size: maxResponseSize,
      }),
    }, timeoutMs)
    await recordQverisUsage({
      toolId,
      searchId,
      sessionId,
      parameters,
      maxResponseSize,
      timeoutMs,
      startedAt,
      finishedAt: new Date(),
      elapsedMs: Date.now() - started,
      response: response as QverisExecuteResponse<unknown>,
      meta,
    })
    return response
  } catch (error) {
    await recordQverisUsage({
      toolId,
      searchId,
      sessionId,
      parameters,
      maxResponseSize,
      timeoutMs,
      startedAt,
      finishedAt: new Date(),
      elapsedMs: Date.now() - started,
      error,
      meta,
    })
    throw error
  }
}

/**
 * Convenience helper: discover + call in one shot, picking the top-ranked tool.
 * Useful when you just want "give me A-share quote for 002518".
 */
export async function discoverAndCall<T = unknown>(opts: {
  query: string
  parameters: Record<string, unknown>
  sessionId?: string
  preferToolId?: string
}): Promise<QverisExecuteResponse<T> & { tool: QverisTool }> {
  const search = await discover(opts.query, opts.sessionId, 10)
  if (!search.results.length) {
    throw new Error(`Qveris discover 未找到匹配工具: ${opts.query}`)
  }
  const tool =
    (opts.preferToolId && search.results.find((t) => t.tool_id === opts.preferToolId)) ||
    search.results.sort((a, b) => (b.stats?.success_rate ?? 0) - (a.stats?.success_rate ?? 0))[0]

  const exec = await call<T>(tool.tool_id, search.search_id, opts.parameters, opts.sessionId, undefined, undefined, {
    source: "discover-and-call",
    category: "manual",
  })
  return { ...exec, tool }
}
