import { NextResponse } from "next/server"
import { extractModelError, resolveModelConfig, type ProviderId } from "@/lib/model-providers"
import { callQverisDefaultModel } from "@/lib/qveris-model"
import { parseModelJson } from "@/lib/strategy-lab"
import {
  buildFactorDiscoverySystemPrompt,
  candidateToCustomFactor,
  heuristicFactorCandidate,
  normalizeFactorCandidate,
} from "@/lib/factor-lab"
import { enforceRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DiscoverFactorRequest = {
  idea?: string
  provider?: ProviderId
  baseUrl?: string
  model?: string
  apiKey?: string
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, { namespace: "factor-discover", limit: 10, windowMs: 60_000 })
  if (limited) return limited

  let body: DiscoverFactorRequest
  try {
    body = (await req.json()) as DiscoverFactorRequest
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 })
  }

  const idea = body.idea?.trim()
  if (!idea) {
    return NextResponse.json({ error: "请先输入因子想法" }, { status: 400 })
  }

  const clippedIdea = idea.slice(0, 12_000)
  const fallback = heuristicFactorCandidate(clippedIdea)
  const config = resolveModelConfig(body)

  if (!config.ok) {
    if (isDefaultProvider(body.provider) && process.env.QVERIS_API_KEY) {
      try {
        const result = await callQverisDefaultModel({
          temperature: 0.1,
          maxTokens: 2200,
          messages: [
            { role: "system", content: buildFactorDiscoverySystemPrompt() },
            { role: "user", content: `请把这个因子想法转成候选量化因子：\n${clippedIdea}` },
          ],
        })
        const parsed = parseModelJson(result.content)
        const candidate = normalizeFactorCandidate(parsed, fallback)
        return NextResponse.json({
          source: "ai",
          candidate,
          factor: candidateToCustomFactor(candidate, clippedIdea),
          provider: result.provider,
          model: result.model,
          usage: result.usage,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "默认模型调用失败"
        return NextResponse.json({
          source: "heuristic",
          warning: `${message}。已先用本地规则生成候选因子。`,
          candidate: fallback,
          factor: candidateToCustomFactor(fallback, clippedIdea),
          provider: "default",
          model: "qveris-default",
          usage: null,
        })
      }
    }
    return NextResponse.json({
      source: "heuristic",
      warning: `${config.error}。已先用本地规则生成候选因子。`,
      candidate: fallback,
      factor: candidateToCustomFactor(fallback, clippedIdea),
      provider: body.provider ?? "default",
      model: body.model ?? null,
      usage: null,
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: buildFactorDiscoverySystemPrompt() },
          { role: "user", content: `请把这个因子想法转成候选量化因子：\n${clippedIdea}` },
        ],
      }),
      signal: controller.signal,
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      return NextResponse.json({
        source: "heuristic",
        warning: `${extractModelError(json) ?? `模型接口返回 HTTP ${res.status}`}。已先用本地规则生成候选因子。`,
        candidate: fallback,
        factor: candidateToCustomFactor(fallback, clippedIdea),
        provider: config.provider,
        model: config.model,
        usage: null,
      })
    }

    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({
        source: "heuristic",
        warning: "模型响应为空，已先用本地规则生成候选因子。",
        candidate: fallback,
        factor: candidateToCustomFactor(fallback, clippedIdea),
        provider: config.provider,
        model: config.model,
        usage: json?.usage ?? null,
      })
    }

    try {
      const parsed = parseModelJson(content)
      const candidate = normalizeFactorCandidate(parsed, fallback)
      return NextResponse.json({
        source: "ai",
        candidate,
        factor: candidateToCustomFactor(candidate, clippedIdea),
        provider: config.provider,
        model: config.model,
        usage: json?.usage ?? null,
      })
    } catch {
      return NextResponse.json({
        source: "heuristic",
        warning: "模型没有返回可解析 JSON，已先用本地规则生成候选因子。",
        rawContent: content,
        candidate: fallback,
        factor: candidateToCustomFactor(fallback, clippedIdea),
        provider: config.provider,
        model: config.model,
        usage: json?.usage ?? null,
      })
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "模型接口超时"
      : error instanceof Error
        ? error.message
        : "模型调用失败"
    return NextResponse.json({
      source: "heuristic",
      warning: `${message}。已先用本地规则生成候选因子。`,
      candidate: fallback,
      factor: candidateToCustomFactor(fallback, clippedIdea),
      provider: config.provider,
      model: config.model,
      usage: null,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function isDefaultProvider(provider?: ProviderId) {
  return !provider || provider === "default"
}
