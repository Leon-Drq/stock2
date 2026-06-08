import { NextResponse } from "next/server"

type RateLimitConfig = {
  namespace: string
  limit: number
  windowMs: number
}

type RateLimitBucket = {
  count: number
  resetAt: number
}

declare global {
  var __stockRadarRateLimits: Map<string, RateLimitBucket> | undefined
}

function buckets() {
  globalThis.__stockRadarRateLimits ??= new Map()
  return globalThis.__stockRadarRateLimits
}

export function enforceRateLimit(request: Request, config: RateLimitConfig) {
  const now = Date.now()
  const store = buckets()
  const key = `${config.namespace}:${requestIdentity(request)}`
  const existing = store.get(key)
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + config.windowMs }

  bucket.count += 1
  store.set(key, bucket)

  cleanupExpiredBuckets(store, now)

  const remaining = Math.max(0, config.limit - bucket.count)
  const headers = {
    "X-RateLimit-Limit": String(config.limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
  }

  if (bucket.count <= config.limit) return null

  return NextResponse.json(
    { ok: false, error: "请求过于频繁，请稍后再试。" },
    {
      status: 429,
      headers: {
        ...headers,
        "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      },
    },
  )
}

function requestIdentity(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwardedFor ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-vercel-forwarded-for") ||
    "anonymous"
}

function cleanupExpiredBuckets(store: Map<string, RateLimitBucket>, now: number) {
  if (store.size < 1000) return
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key)
  }
}
