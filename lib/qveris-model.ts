import { call, discover, type QverisExecuteResponse, type QverisTool } from "@/lib/qveris"

type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

type QverisChatData = {
  choices?: Array<{
    text?: unknown
    message?: {
      content?: unknown
    }
  }>
  content?: unknown
  message?: unknown
  output_text?: unknown
  response?: unknown
  result?: unknown
  text?: unknown
  usage?: unknown
}

export type QverisDefaultModelResult = {
  provider: "default"
  baseUrl: "qveris://chat.completions"
  model: string
  content: string
  usage: unknown
}

const DEFAULT_QVERIS_MODEL = "gpt-4.1"
const CHAT_COMPLETION_QUERY = "wangsu aigateway chat create completion model messages"
const FALLBACK_CHAT_QUERIES = [
  "chat completions create text model OpenAI compatible",
  "BigModel glm chat completions create",
]
const PREFERRED_CHAT_TOOL_PREFIXES = [
  "wangsu.aigateway.chat.create",
  "bigmodel.chat.completions",
]

export async function callQverisDefaultModel({
  messages,
  temperature = 0.2,
  maxTokens = 1800,
}: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}): Promise<QverisDefaultModelResult> {
  const requestedModel = process.env.QVERIS_DEFAULT_MODEL?.trim() || DEFAULT_QVERIS_MODEL
  const { searchId, tool } = await discoverChatCompletionTool()
  if (!tool) {
    throw new Error("Qveris 默认模型工具不可用")
  }

  let model = requestedModel
  let exec: QverisExecuteResponse<QverisChatData>
  try {
    exec = await executeChatCompletion(tool, searchId, { model, messages, temperature, maxTokens })
  } catch (error) {
    if (model !== DEFAULT_QVERIS_MODEL && isRetryableExecutionError(error)) {
      model = DEFAULT_QVERIS_MODEL
      exec = await executeChatCompletion(tool, searchId, { model, messages, temperature, maxTokens })
    } else {
      throw error
    }
  }
  if (!exec.success && model !== DEFAULT_QVERIS_MODEL && isUnsupportedModelError(exec)) {
    model = DEFAULT_QVERIS_MODEL
    exec = await executeChatCompletion(tool, searchId, { model, messages, temperature, maxTokens })
  }

  if (!exec.success) {
    throw new Error(modelErrorMessage(exec) || "Qveris 默认模型调用失败")
  }

  const content = extractChatContent(exec)
  if (!content) {
    throw new Error("Qveris 默认模型响应为空或格式不兼容")
  }

  return {
    provider: "default",
    baseUrl: "qveris://chat.completions",
    model,
    content,
    usage: extractUsage(exec),
  }
}

async function discoverChatCompletionTool() {
  for (const query of [CHAT_COMPLETION_QUERY, ...FALLBACK_CHAT_QUERIES]) {
    const search = await discover(query, undefined, 10)
    const tool = pickChatCompletionTool(search.results)
    if (tool) return { searchId: search.search_id, tool }
  }
  return { searchId: "", tool: null }
}

function pickChatCompletionTool(tools: QverisTool[]) {
  for (const prefix of PREFERRED_CHAT_TOOL_PREFIXES) {
    const tool = tools.find((item) => item.tool_id.startsWith(prefix))
    if (tool) return tool
  }
  return tools.find((item) => {
    const name = item.name.toLowerCase()
    const id = item.tool_id.toLowerCase()
    const params = new Set(item.params?.map((param) => param.name))
    return /chat completion/.test(name) &&
      params.has("model") &&
      params.has("messages") &&
      !/(models?\.|list|retrieve|embedding|image)/.test(id)
  }) ?? null
}

async function executeChatCompletion(
  tool: QverisTool,
  searchId: string,
  input: {
    model: string
    messages: ChatMessage[]
    temperature: number
    maxTokens: number
  },
) {
  const params = new Set(tool.params?.map((param) => param.name))
  const parameters: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  }
  if (params.has("temperature")) parameters.temperature = input.temperature
  if (params.has("max_tokens")) parameters.max_tokens = input.maxTokens
  if (params.has("max_output_tokens")) parameters.max_output_tokens = input.maxTokens

  return call<QverisChatData>(
    tool.tool_id,
    searchId,
    parameters,
    undefined,
    32_000,
    45_000,
    {
      source: "qveris-default-model",
      category: "ai_model",
      note: input.model,
    },
  )
}

function extractChatContent(exec: QverisExecuteResponse<QverisChatData>) {
  const data = exec.result.data
  const candidates = [
    data?.choices?.[0]?.message?.content,
    data?.choices?.[0]?.text,
    data?.output_text,
    data?.content,
    data?.message,
    data?.response,
    data?.result,
    data,
    exec.result.message,
    exec.result.truncated_content,
  ]
  for (const candidate of candidates) {
    const text = contentToText(candidate)
    if (text) return text
  }
  return ""
}

function contentToText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (!value) return ""
  if (Array.isArray(value)) {
    return value.map(contentToText).filter(Boolean).join("\n").trim()
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    return contentToText(obj.text) ||
      contentToText(obj.output_text) ||
      contentToText(obj.content) ||
      contentToText(obj.message)
  }
  return ""
}

function extractUsage(exec: QverisExecuteResponse<QverisChatData>) {
  const data = exec.result.data as (QverisChatData & { usage?: unknown }) | undefined
  return data?.usage ?? null
}

function isUnsupportedModelError(exec: QverisExecuteResponse<QverisChatData>) {
  return /model_unsupported|unsupported model|invalid model/i.test(modelErrorMessage(exec))
}

function isRetryableExecutionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|model_unsupported|unsupported model|invalid model/i.test(message)
}

function modelErrorMessage(exec: QverisExecuteResponse<QverisChatData>) {
  const data = exec.result.data
  const nested = data && typeof data === "object" ? data as { error?: unknown; message?: unknown } : null
  if (typeof exec.error_message === "string" && exec.error_message.trim()) return exec.error_message
  if (typeof nested?.message === "string") return nested.message
  if (nested?.error && typeof nested.error === "object") {
    const error = nested.error as { message?: unknown; code?: unknown }
    if (typeof error.message === "string") return error.message
    if (typeof error.code === "string") return error.code
  }
  if (typeof nested?.error === "string") return nested.error
  return ""
}
