import { NextResponse } from "next/server"
import { extractModelError, resolveModelConfig, type ProviderId } from "@/lib/model-providers"
import { callQverisDefaultModel } from "@/lib/qveris-model"
import {
  buildStrategyLabSystemPrompt,
  heuristicStrategyDraft,
  normalizeStrategyDraft,
  parseModelJson,
  type StrategyLabMode,
} from "@/lib/strategy-lab"
import { enforceRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

type AnalyzeRequest = {
  provider?: ProviderId
  baseUrl?: string
  model?: string
  apiKey?: string
  mode?: StrategyLabMode
  title?: string
  text?: string
  imageDataUrl?: string
  imageName?: string
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, { namespace: "strategy-lab-analyze", limit: 8, windowMs: 60_000 })
  if (limited) return limited

  let body: AnalyzeRequest
  try {
    body = (await req.json()) as AnalyzeRequest
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 })
  }

  const mode = body.mode === "market-observation" ? "market-observation" : "document"
  const text = body.text?.trim() ?? ""
  const imageDataUrl = normalizeImageDataUrl(body.imageDataUrl)
  if (!text && !imageDataUrl) {
    return NextResponse.json({
      error: mode === "market-observation" ? "请先输入观察文字或上传截图" : "请先上传或粘贴策略文档正文",
    }, { status: 400 })
  }

  const title = body.title?.trim()
  const clippedText = text.slice(0, 60_000)
  const fallbackText = clippedText || (imageDataUrl ? `用户上传了市场截图：${body.imageName || "未命名截图"}。请识别截图中的股票、价格、涨跌幅、成交、盘口和技术指标，并生成可验证策略。` : "")
  const fallbackDraft = heuristicStrategyDraft({
    title,
    text: fallbackText,
    mode,
    imageAttached: Boolean(imageDataUrl),
    imageName: body.imageName,
  })
  const systemPrompt = buildStrategyLabSystemPrompt(mode)
  const userPrompt = buildUserPrompt({ title, text: fallbackText, mode, imageAttached: Boolean(imageDataUrl), imageName: body.imageName })

  if (isDefaultProvider(body.provider)) {
    if (!process.env.QVERIS_API_KEY) {
      return NextResponse.json({
        source: "heuristic",
        warning: "默认模型未配置 QVERIS_API_KEY。已先用本地关键词规则生成可编辑草稿。",
        draft: fallbackDraft,
        provider: "default",
        model: "qveris-default",
        usage: null,
      })
    }
    if (imageDataUrl && !clippedText) {
      return NextResponse.json({
        source: "heuristic",
        warning: "默认模型当前按文本通道调用，无法可靠读取纯截图。已先生成研究草稿；请补充截图里的股票、时间、价格、涨跌幅或改用支持视觉的模型。",
        draft: fallbackDraft,
        provider: "default",
        model: "qveris-default",
        usage: null,
      })
    }
    try {
      const result = await callQverisDefaultModel({
        temperature: 0.1,
        maxTokens: 2600,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      })
      const parsed = parseModelJson(result.content)
      const draft = normalizeStrategyDraft(parsed, fallbackDraft, "ai")
      return NextResponse.json({
        source: "ai",
        draft,
        provider: result.provider,
        baseUrl: result.baseUrl,
        model: result.model,
        usage: result.usage,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "默认模型调用失败"
      return NextResponse.json({
        source: "heuristic",
        warning: `${message}。已先用本地关键词规则生成可编辑草稿。`,
        draft: fallbackDraft,
        provider: "default",
        model: "qveris-default",
        usage: null,
      })
    }
  }

  const config = resolveModelConfig(body)
  if (!config.ok) {
    return NextResponse.json({
      source: "heuristic",
      warning: `${config.error}。已先用本地关键词规则生成可编辑草稿。`,
      draft: fallbackDraft,
      provider: body.provider ?? "kimi",
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
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: imageDataUrl ? buildVisionUserContent(userPrompt, imageDataUrl) : userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    })

    const json = await res.json().catch(() => null)
    if (!res.ok) {
      return NextResponse.json({
        source: "heuristic",
        warning: `${extractModelError(json) ?? `模型接口返回 HTTP ${res.status}`}。已先用本地关键词规则生成可编辑草稿。`,
        draft: fallbackDraft,
        provider: config.provider,
        model: config.model,
        usage: null,
      })
    }

    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({
        source: "heuristic",
        warning: "模型响应为空，已先用本地关键词规则生成可编辑草稿。",
        draft: fallbackDraft,
        provider: config.provider,
        model: config.model,
        usage: json?.usage ?? null,
      })
    }

    try {
      const parsed = parseModelJson(content)
      const draft = normalizeStrategyDraft(parsed, fallbackDraft, "ai")
      return NextResponse.json({
        source: "ai",
        draft,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
        usage: json?.usage ?? null,
      })
    } catch {
      return NextResponse.json({
        source: "heuristic",
        warning: "模型没有返回可解析 JSON，已先用本地关键词规则生成可编辑草稿。",
        rawContent: content,
        draft: fallbackDraft,
        provider: config.provider,
        model: config.model,
        usage: json?.usage ?? null,
      })
    }
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError"
      ? "模型接口超时"
      : err instanceof Error
        ? err.message
        : "模型调用失败"
    return NextResponse.json({
      source: "heuristic",
      warning: `${message}。已先用本地关键词规则生成可编辑草稿。`,
      draft: fallbackDraft,
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

function buildUserPrompt({
  title,
  text,
  mode,
  imageAttached,
  imageName,
}: {
  title?: string
  text: string
  mode: StrategyLabMode
  imageAttached: boolean
  imageName?: string
}) {
  const header = mode === "market-observation"
    ? "请把下面市场观察转成：样本识别、上涨原因假设、因子候选、数据缺口、可回测策略草稿。"
    : "请把下面文档转成可回测策略草稿。"
  return [
    `标题：${title || (mode === "market-observation" ? "市场现象研究" : "未命名策略文档")}`,
    `模式：${mode}`,
    imageAttached ? `已附加截图：${imageName || "market-screenshot"}` : "未附加截图",
    header,
    text,
  ].filter(Boolean).join("\n\n")
}

function buildVisionUserContent(prompt: string, imageDataUrl: string) {
  return [
    { type: "text", text: prompt },
    {
      type: "image_url",
      image_url: {
        url: imageDataUrl,
      },
    },
  ]
}

function normalizeImageDataUrl(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) return ""
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(trimmed)) return ""
  // Keep requests comfortably below Vercel/function body limits after client-side compression.
  if (trimmed.length > 2_800_000) return ""
  return trimmed
}
