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

export type DefaultModelRuntime = {
  provider: Exclude<ProviderId, "default" | "custom">
  baseUrl: string
  model: string
  keyHint: string
  keyConfigured: boolean
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
    process.env.MODEL_PROVIDER_KEY,
    process.env.DEFAULT_MODEL_API_KEY,
    process.env.MODEL_API_KEY,
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

export function getDefaultModelRuntime(): DefaultModelRuntime {
  const configuredModel = firstNonEmpty(process.env.DEFAULT_MODEL_NAME, process.env.MODEL_NAME)
  const configuredBaseUrl = firstNonEmpty(process.env.DEFAULT_MODEL_BASE_URL, process.env.MODEL_BASE_URL)
  const provider = getDefaultProvider(configuredModel, configuredBaseUrl)
  const preset = PROVIDER_DEFAULTS[provider]
  const baseUrl = normalizeBaseUrl(firstNonEmpty(configuredBaseUrl, preset.baseUrl))
  const model = firstNonEmpty(configuredModel, preset.model)
  const keyEntries: Array<[string, string | undefined]> = [
    ["MODEL_PROVIDER_KEY", process.env.MODEL_PROVIDER_KEY],
    ["DEFAULT_MODEL_API_KEY", process.env.DEFAULT_MODEL_API_KEY],
    ["MODEL_API_KEY", process.env.MODEL_API_KEY],
    [preset.envKey, process.env[preset.envKey]],
  ]
  const configured = keyEntries.find(([, value]) => Boolean(value?.trim()))

  return {
    provider,
    baseUrl,
    model,
    keyHint: configured?.[0] ?? "MODEL_PROVIDER_KEY",
    keyConfigured: Boolean(configured),
  }
}

function getDefaultModelPreset(): ModelProviderDefault {
  const provider = getDefaultProvider(
    firstNonEmpty(process.env.DEFAULT_MODEL_NAME, process.env.MODEL_NAME),
    firstNonEmpty(process.env.DEFAULT_MODEL_BASE_URL, process.env.MODEL_BASE_URL),
  )
  return PROVIDER_DEFAULTS[provider]
}

function getDefaultProvider(model?: string, baseUrl?: string): Exclude<ProviderId, "default" | "custom"> {
  return normalizeProviderName(firstNonEmpty(process.env.DEFAULT_MODEL_PROVIDER, process.env.MODEL_PROVIDER, process.env.AI_PROVIDER)) ??
    inferProviderFromModel(model) ??
    inferProviderFromBaseUrl(baseUrl) ??
    inferProviderFromKey() ??
    "kimi"
}

function normalizeProviderName(value?: string): Exclude<ProviderId, "default" | "custom"> | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "kimi" || normalized === "openai" || normalized === "deepseek" || normalized === "qwen") {
    return normalized
  }
  return null
}

function inferProviderFromModel(value?: string): Exclude<ProviderId, "default" | "custom"> | null {
  const model = value?.trim().toLowerCase()
  if (!model) return null
  if (model.startsWith("deepseek-")) return "deepseek"
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai"
  if (model.startsWith("moonshot-") || model.startsWith("kimi-")) return "kimi"
  if (model.startsWith("qwen-")) return "qwen"
  return null
}

function inferProviderFromBaseUrl(value?: string): Exclude<ProviderId, "default" | "custom"> | null {
  const url = value?.trim().toLowerCase()
  if (!url) return null
  if (url.includes("deepseek.com")) return "deepseek"
  if (url.includes("openai.com")) return "openai"
  if (url.includes("moonshot.cn")) return "kimi"
  if (url.includes("dashscope.aliyuncs.com") || url.includes("aliyuncs.com")) return "qwen"
  return null
}

function inferProviderFromKey(): Exclude<ProviderId, "default" | "custom"> | null {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek"
  if (process.env.OPENAI_API_KEY?.trim()) return "openai"
  if (process.env.KIMI_API_KEY?.trim()) return "kimi"
  if (process.env.QWEN_API_KEY?.trim()) return "qwen"
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
