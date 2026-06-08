/**
 * 数据源健康监控：对每个 DataSource 调 Qveris discover（免费），
 * 把匹配到的工具列表和综合健康度返回。
 *
 * Qveris 行为实测：
 * - /search API 单次 limit 上限 100
 * - response.total 字段 == returned 数（不是匹配总数）
 * - 单 query 真实命中池可能远超 100，但 Qveris 按相关性排序后截断
 * - 限速 30 次/分钟（滑动窗口 + 突发抑制），超出 429
 *
 * 我们用 limit=20 采样 Top-20 相关工具，在「代表性」与「限速预算」间平衡。
 *
 * 缓存与容灾：
 * - 每个 source 独立缓存：成功后 TTL 5 分钟
 * - 429/网络错误时降级回最近一次成功值（保留 1 小时），并打 stale 标记
 * - 这样限速窗口不会把整页面"清零"，已经探活成功的 source 仍然可看
 */
import { discover, type QverisTool } from "@/lib/qveris"
import { DATA_SOURCES, type DataSource } from "@/lib/catalog"

export type HealthStatus = "healthy" | "degraded" | "down" | "rate-limited" | "unknown"

export type DataHealthIssue = {
  severity: "info" | "warning" | "critical"
  label: string
  detail: string
  owner: "Qveris" | "本系统" | "数据口径"
}

export type DataSourceHealth = {
  source: DataSource
  status: HealthStatus
  /**
   * Qveris 按相关性返回的 Top-N 工具数。N = sampleLimit。
   * 不是"真实命中总数"——Qveris 没暴露这个值。
   */
  sampledCount: number
  /** 采样上限（discover 调用时传给 Qveris 的 limit 值） */
  sampleLimit: number
  /** 兼容旧字段：等于 sampledCount */
  toolCount: number
  topTools: QverisTool[]
  avgSuccessRate: number | null
  avgLatencyMs: number | null
  checkedAt: string
  issues: DataHealthIssue[]
  /** 当前数据是降级数据时为 true（最近一次探活失败，回退到上次成功值） */
  stale?: boolean
  error?: string
}

export type HealthReport = {
  checkedAt: string
  apiKeyConfigured: boolean
  totalSources: number
  healthyCount: number
  degradedCount: number
  downCount: number
  rateLimitedCount: number
  staleCount: number
  /** 12 个 source 各自采样的 Top-N 工具之和（每 source 上限 sampleLimit=20）*/
  totalTools: number
  items: DataSourceHealth[]
}

const SAMPLE_LIMIT = 20
const FRESH_TTL_MS = 5 * 60 * 1000 // 5 分钟内不重复探活
const STALE_KEEP_MS = 60 * 60 * 1000 // 即使失败，最近 1 小时内的旧值仍可降级使用
const PROBE_TIMEOUT_MS = 6_000
const BATCH_DELAY_MS = 1_000

function classify(successRate: number | null, toolCount: number): HealthStatus {
  if (toolCount === 0) return "down"
  if (successRate == null) return "degraded"
  if (successRate >= 0.9) return "healthy"
  if (successRate >= 0.7) return "degraded"
  return "down"
}

function normalizeError(msg: string) {
  if (/429|Rate limit|Too many/i.test(msg)) return "Qveris 限速"
  if (/timeout|超时/i.test(msg)) return "Qveris 响应超时"
  if (/QVERIS_API_KEY/i.test(msg)) return "本系统密钥未配置"
  if (/row-level security|RLS/i.test(msg)) return "数据库写入权限"
  return msg.slice(0, 80)
}

function buildIssues(opts: {
  source: DataSource
  status: HealthStatus
  tools: QverisTool[]
  avgSuccessRate: number | null
  avgLatencyMs: number | null
  error?: string
  stale?: boolean
}): DataHealthIssue[] {
  const { source, status, tools, avgSuccessRate, avgLatencyMs, error, stale } = opts
  const issues: DataHealthIssue[] = []

  if (error) {
    const normalized = normalizeError(error)
    const owner: DataHealthIssue["owner"] =
      /QVERIS_API_KEY|row-level security|RLS|数据库写入权限/i.test(error) ? "本系统" : "Qveris"
    issues.push({
      severity: status === "healthy" ? "warning" : "critical",
      label: normalized,
      detail: stale
        ? "本次探活失败，页面正在显示最近一次成功缓存。数据没有清零，但新鲜度需要确认。"
        : "本次探活没有拿到有效结果，需要查看网络、限速、密钥或 Qveris 服务返回。",
      owner,
    })
  }

  if (tools.length === 0 && !error) {
    issues.push({
      severity: "critical",
      label: "未匹配到可用工具",
      detail: `discoverQuery「${source.discoverQuery}」没有返回工具，可能是查询词不准、Qveris 工具目录缺口，或该数据源尚未接入。`,
      owner: "数据口径",
    })
  }

  if (tools.length > 0 && avgSuccessRate == null) {
    issues.push({
      severity: "warning",
      label: "工具缺少成功率统计",
      detail: "Qveris 返回了候选工具，但没有 success_rate 元数据。当前只能按降级处理，后续应做实际 call 抽样验证。",
      owner: "Qveris",
    })
  }

  if (avgSuccessRate != null && avgSuccessRate < 0.7) {
    issues.push({
      severity: "critical",
      label: "工具历史成功率偏低",
      detail: `Top 工具平均成功率约 ${Math.round(avgSuccessRate * 100)}%，低于 70%。这更像是 Qveris 工具稳定性或参数适配问题，不适合直接用于生产链路。`,
      owner: "Qveris",
    })
  } else if (avgSuccessRate != null && avgSuccessRate < 0.9) {
    issues.push({
      severity: "warning",
      label: "工具稳定性降级",
      detail: `Top 工具平均成功率约 ${Math.round(avgSuccessRate * 100)}%，低于 90%。可用于探索，但回测和雷达应增加兜底数据源。`,
      owner: "Qveris",
    })
  }

  if (avgLatencyMs != null && avgLatencyMs > 1_200) {
    issues.push({
      severity: "warning",
      label: "响应延迟偏高",
      detail: `平均延迟约 ${avgLatencyMs}ms。对实时行情、雷达刷新和实盘模拟会有体验影响，需要缓存或异步化。`,
      owner: "Qveris",
    })
  }

  if (/实时|Tick|1m|分钟/i.test(`${source.freq} ${source.name}`) && avgLatencyMs != null && avgLatencyMs > 800) {
    issues.push({
      severity: "warning",
      label: "实时链路延迟需关注",
      detail: "这是高频或实时类数据源，延迟超过 800ms 时不适合直接驱动盘中秒级决策，应保留 5 分钟 TTL 或只做信号确认。",
      owner: "本系统",
    })
  }

  if (stale) {
    issues.push({
      severity: "warning",
      label: "正在使用旧缓存",
      detail: "最近一次探活失败，系统用 1 小时内的旧缓存兜底。页面可看，但健康分不能代表当前实时状态。",
      owner: "本系统",
    })
  }

  if (issues.length === 0) {
    issues.push({
      severity: "info",
      label: "探活正常",
      detail: "Qveris discover 返回了候选工具，成功率和延迟都在当前阈值内。仍需用实际 call 抽样验证字段完整性。",
      owner: "本系统",
    })
  }

  return issues
}

type CacheEntry = {
  health: DataSourceHealth
  fetchedAt: number
}

// 模块级缓存（Next.js 同进程内共享，serverless 冷启动会重建）
const cache = new Map<string, CacheEntry>()

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时 ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function probeOne(source: DataSource): Promise<DataSourceHealth> {
  const checkedAt = new Date().toISOString()
  const cached = cache.get(source.id)

  // 1. 命中新鲜缓存，直接返回
  if (cached && Date.now() - cached.fetchedAt < FRESH_TTL_MS) {
    return cached.health
  }

  // 2. 尝试调用 Qveris
  try {
    const res = await withTimeout(
      discover(source.discoverQuery, undefined, SAMPLE_LIMIT),
      PROBE_TIMEOUT_MS,
      `Qveris ${source.name} 探活`,
    )
    const tools = res.results ?? []
    const rates = tools.map((t) => t.stats?.success_rate).filter((v): v is number => typeof v === "number")
    const latencies = tools.map((t) => t.stats?.avg_execution_time_ms).filter((v): v is number => typeof v === "number")
    const avgSuccessRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null
    const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null
    const health: DataSourceHealth = {
      source,
      status: classify(avgSuccessRate, tools.length),
      sampledCount: tools.length,
      sampleLimit: SAMPLE_LIMIT,
      toolCount: tools.length,
      topTools: tools.slice(0, 3),
      avgSuccessRate,
      avgLatencyMs,
      checkedAt,
      issues: buildIssues({
        source,
        status: classify(avgSuccessRate, tools.length),
        tools,
        avgSuccessRate,
        avgLatencyMs,
      }),
    }
    cache.set(source.id, { health, fetchedAt: Date.now() })
    return health
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isRateLimited = /429|Rate limit|Too many/i.test(msg)

    // 3. 失败时优先用旧缓存（即使过期，只要在 STALE_KEEP_MS 内）
    if (cached && Date.now() - cached.fetchedAt < STALE_KEEP_MS) {
      return {
        ...cached.health,
        stale: true,
        error: isRateLimited ? "Qveris 限速 · 显示上次成功值" : msg.slice(0, 100),
        issues: buildIssues({
          source,
          status: cached.health.status,
          tools: cached.health.topTools,
          avgSuccessRate: cached.health.avgSuccessRate,
          avgLatencyMs: cached.health.avgLatencyMs,
          error: isRateLimited ? "Qveris 限速 · 显示上次成功值" : msg.slice(0, 100),
          stale: true,
        }),
      }
    }

    // 4. 完全无缓存时才返回失败态
    const status = isRateLimited ? "rate-limited" : "unknown"
    return {
      source,
      status,
      sampledCount: 0,
      sampleLimit: SAMPLE_LIMIT,
      toolCount: 0,
      topTools: [],
      avgSuccessRate: null,
      avgLatencyMs: null,
      checkedAt,
      error: msg,
      issues: buildIssues({
        source,
        status,
        tools: [],
        avgSuccessRate: null,
        avgLatencyMs: null,
        error: msg,
      }),
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * 拉取全部数据源的健康报告。
 *
 * 限速策略：每批 3 个并发 + 批间隔 2.5s，12 个 source 总耗时 ~10s。
 * 由于 probeOne 内置 5 分钟缓存，正常访问几乎不会真打 Qveris。
 */
export async function getHealthReport(): Promise<HealthReport> {
  const checkedAt = new Date().toISOString()
  const apiKeyConfigured = Boolean(process.env.QVERIS_API_KEY)

  if (!apiKeyConfigured) {
    return {
      checkedAt,
      apiKeyConfigured: false,
      totalSources: DATA_SOURCES.length,
      healthyCount: 0,
      degradedCount: 0,
      downCount: 0,
      rateLimitedCount: 0,
      staleCount: 0,
      totalTools: 0,
      items: DATA_SOURCES.map((source) => ({
        source,
        status: "unknown" as const,
        sampledCount: 0,
        sampleLimit: SAMPLE_LIMIT,
        toolCount: 0,
        topTools: [],
        avgSuccessRate: null,
        avgLatencyMs: null,
        checkedAt,
        error: "QVERIS_API_KEY 未配置",
        issues: buildIssues({
          source,
          status: "unknown",
          tools: [],
          avgSuccessRate: null,
          avgLatencyMs: null,
          error: "QVERIS_API_KEY 未配置",
        }),
      })),
    }
  }

  const items: DataSourceHealth[] = []
  const batchSize = 4
  for (let i = 0; i < DATA_SOURCES.length; i += batchSize) {
    if (i > 0) await sleep(BATCH_DELAY_MS)
    const batch = DATA_SOURCES.slice(i, i + batchSize)
    items.push(...(await Promise.all(batch.map(probeOne))))
  }

  return {
    checkedAt,
    apiKeyConfigured: true,
    totalSources: items.length,
    healthyCount: items.filter((i) => i.status === "healthy").length,
    degradedCount: items.filter((i) => i.status === "degraded").length,
    downCount: items.filter((i) => i.status === "down" || i.status === "unknown").length,
    rateLimitedCount: items.filter((i) => i.status === "rate-limited").length,
    staleCount: items.filter((i) => i.stale).length,
    totalTools: items.reduce((sum, i) => sum + i.sampledCount, 0),
    items,
  }
}

/** 强制清空缓存，下一次 getHealthReport 时全部重新探活。供 refresh 路由调用。 */
export function clearHealthCache() {
  cache.clear()
}
