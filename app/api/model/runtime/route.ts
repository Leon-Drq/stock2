import { NextResponse } from "next/server"
import { getDefaultModelRuntime } from "@/lib/model-providers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const model = getDefaultModelRuntime()
  return NextResponse.json({
    ok: true,
    provider: model.provider,
    model: model.model,
    baseUrl: maskUrl(model.baseUrl),
    keyHint: model.keyHint,
    keyConfigured: model.keyConfigured,
  })
}

function maskUrl(value: string) {
  if (!value) return ""
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return value.slice(0, 64)
  }
}
