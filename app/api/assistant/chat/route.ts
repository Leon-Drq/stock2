import { NextResponse } from "next/server"
import { DATA_SOURCES, FACTORS, STRATEGIES } from "@/lib/catalog"
import { extractModelError, resolveModelConfig, type ProviderId } from "@/lib/model-providers"
import { callQverisDefaultModel } from "@/lib/qveris-model"
import { enforceRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

type ChatRequest = {
  provider?: ProviderId
  baseUrl?: string
  model?: string
  apiKey?: string
  prompt?: string
  temperature?: number
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, { namespace: "assistant-chat", limit: 12, windowMs: 60_000 })
  if (limited) return limited

  let body: ChatRequest
  try {
    body = (await req.json()) as ChatRequest
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 })
  }

  const prompt = body.prompt?.trim()
  if (!prompt) {
    return NextResponse.json({ error: "请输入研究问题" }, { status: 400 })
  }

  const config = resolveModelConfig(body)
  if (!config.ok) {
    if (isDefaultProvider(body.provider) && process.env.QVERIS_API_KEY) {
      try {
        const result = await callQverisDefaultModel({
          temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: prompt },
          ],
        })
        return NextResponse.json(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : "默认模型调用失败"
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }
    return NextResponse.json({ error: config.error }, { status: config.status })
  }

  const endpoint = `${config.baseUrl}/chat/completions`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      const message = extractModelError(json) ?? `模型接口返回 HTTP ${res.status}`
      return NextResponse.json({ error: message }, { status: res.status })
    }

    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "模型响应为空或格式不兼容" }, { status: 502 })
    }

    return NextResponse.json({
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      content,
      usage: json?.usage ?? null,
    })
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "模型接口超时，请稍后重试或换一个模型"
      : err instanceof Error
        ? err.message
        : "模型调用失败"
    return NextResponse.json({ error: message }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}

function isDefaultProvider(provider?: ProviderId) {
  return !provider || provider === "default"
}

function buildSystemPrompt() {
  const dataSources = DATA_SOURCES.map((s) => `${s.name}(${s.category}, ${s.freq}, ${s.coverage})`).join("；")
  const factors = FACTORS.map((f) => `${f.name}[${f.category}, ${f.freq}, IC=${f.ic}, IR=${f.ir}, 胜率=${f.win}%]`).join("；")
  const strategies = STRATEGIES.map((s) => `${s.name}[${s.freq}, 年化=${s.annualReturn}%, 回撤=${s.maxDrawdown}%, 胜率=${s.winRate}%]`).join("；")

  return [
    "你是 Stock Radar 的 A 股量化研究助手。",
    "目标：把用户的一句话研究想法拆解成可执行的研究计划，而不是直接给投资承诺。",
    "请用中文回答，结构清晰，尽量包含：1. 研究意图判断；2. 需要查询的数据；3. 推荐因子；4. 可形成的策略规则；5. 回测与风控；6. 风险提示。",
    "不要声称已经完成真实交易或真实回测，除非用户提供了结果。涉及实时价格时说明需要 Qveris 行情确认。",
    `可用数据源：${dataSources}`,
    `可用因子：${factors}`,
    `已有策略：${strategies}`,
  ].join("\n")
}
