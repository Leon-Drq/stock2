export type ProviderId = "default" | "kimi" | "openai" | "deepseek" | "qwen" | "custom"

export type ModelProviderDefault = {
  baseUrl: string
  model: string
  envKey: string
}

export const PROVIDER_DEFAULTS: Record<Exclude<ProviderId, "default" | "custom">, ModelProviderDefault> = {
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    envKey: "KIMI_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    envKey: "OPENAI_API_KEY",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    envKey: "DEEPSEEK_API_KEY",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    envKey: "QWEN_API_KEY",
  },
}

export type ModelRequestConfig = {
  provider?: ProviderId
  baseUrl?: string
  model?: string
  apiKey?: string
}

export type ResolvedModelConfig =
  | {
      ok: true
      provider: ProviderId
      baseUrl: string
      model: string
      apiKey: string
    }
  | {
      ok: false
      error: string
      status: number
    }

export function resolveModelConfig(config: ModelRequestConfig): ResolvedModelConfig {
  const provider = config.provider ?? "default"
  const defaults = provider === "default" ? getDefaultModelPreset() : provider === "custom" ? null : PROVIDER_DEFAULTS[provider]
  if (provider !== "custom" && !defaults) {
    return { ok: false, error: "未知模型提供商", status: 400 }
  }

  const baseUrl = normalizeBaseUrl(
    firstNonEmpty(
      config.baseUrl,
      provider === "default" ? process.env.DEFAULT_MODEL_BASE_URL : undefined,
      provider === "default" ? process.env.MODEL_BASE_URL : undefined,
      defaults?.baseUrl,
    ),
  )
  const model = firstNonEmpty(
    config.model,
    provider === "default" ? process.env.DEFAULT_MODEL_NAME : undefined,
    provider === "default" ? process.env.MODEL_NAME : undefined,
    defaults?.model,
  )
  const apiKey = firstNonEmpty(
    config.apiKey,
    provider === "default" ? process.env.MODEL_PROVIDER_KEY : undefined,
    provider === "default" ? process.env.DEFAULT_MODEL_API_KEY : undefined,
    provider === "default" ? process.env.MODEL_API_KEY : undefined,
    defaults ? process.env[defaults.envKey] : undefined,
  )

  if (!baseUrl) {
    return { ok: false, error: "请填写模型 API Base URL", status: 400 }
  }
  if (!model) {
    return { ok: false, error: "请填写模型名称", status: 400 }
  }
  if (!apiKey) {
    return { ok: false, error: "请填写 API Key，或在 .env.local 中配置对应环境变量", status: 400 }
  }

  return { ok: true, provider, baseUrl, model, apiKey }
}

function getDefaultModelPreset(): ModelProviderDefault {
  const provider = normalizeProviderName(
    firstNonEmpty(process.env.DEFAULT_MODEL_PROVIDER, process.env.MODEL_PROVIDER, process.env.AI_PROVIDER),
  )
  if (provider && provider in PROVIDER_DEFAULTS) {
    return PROVIDER_DEFAULTS[provider]
  }
  return PROVIDER_DEFAULTS.kimi
}

function normalizeProviderName(value?: string): Exclude<ProviderId, "default" | "custom"> | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "kimi" || normalized === "openai" || normalized === "deepseek" || normalized === "qwen") {
    return normalized
  }
  return null
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? ""
}

export function normalizeBaseUrl(value?: string) {
  const trimmed = value?.trim().replace(/\/+$/, "")
  if (!trimmed) return ""
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" && !isAllowedLocalHttp(url)) return ""
    if (isPrivateHost(url.hostname) && !isAllowedLocalHttp(url)) return ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return ""
  }
}

function isAllowedLocalHttp(url: URL) {
  const host = normalizeHostname(url.hostname)
  return process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(host)
}

function isPrivateHost(hostname: string) {
  const host = normalizeHostname(hostname)
  if (host === "localhost" || host.endsWith(".local")) return true
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  if (/^(fc|fd|fe80):/i.test(host)) return true
  return false
}

function normalizeHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
}

export function extractModelError(json: unknown) {
  if (!json || typeof json !== "object") return null
  const obj = json as { error?: unknown; message?: unknown }
  if (typeof obj.message === "string") return obj.message
  if (obj.error && typeof obj.error === "object") {
    const error = obj.error as { message?: unknown; code?: unknown }
    if (typeof error.message === "string") return error.message
    if (typeof error.code === "string") return error.code
  }
  if (typeof obj.error === "string") return obj.error
  return null
}
