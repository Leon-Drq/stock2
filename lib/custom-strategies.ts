import type { BacktestReport } from "@/lib/backtest"
import type { Strategy, StrategyAdmission } from "@/lib/catalog"
import type { StrategyDraft } from "@/lib/strategy-lab"
import { buildFactorDataPlanForDraft } from "@/lib/factor-data-bindings"
import { formatBeijingDateTime } from "@/lib/format"

export const CUSTOM_STRATEGIES_STORAGE_KEY = "stock-radar.custom-strategies.v1"

export type StoredStrategyDraft = {
  id: string
  name: string
  draft: StrategyDraft
  status: "queued" | "backtested" | "failed"
  source: "strategy-lab"
  createdAt: string
  updatedAt: string
  report?: BacktestReport
  error?: string
}

export function loadCustomStrategies(): StoredStrategyDraft[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(CUSTOM_STRATEGIES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeStoredStrategyDraft)
      .filter((item): item is StoredStrategyDraft => Boolean(item))
  } catch {
    return []
  }
}

export function saveCustomStrategies(items: StoredStrategyDraft[]) {
  if (typeof window === "undefined") return
  const deduped = new Map<string, StoredStrategyDraft>()
  for (const rawItem of items) {
    const item = normalizeStoredStrategyDraft(rawItem)
    if (item) deduped.set(item.id, item)
  }
  window.localStorage.setItem(CUSTOM_STRATEGIES_STORAGE_KEY, JSON.stringify(Array.from(deduped.values())))
}

export function persistStrategyDraftForBacktest(draft: StrategyDraft) {
  const now = new Date().toISOString()
  const id = buildStrategyDraftId(draft)
  const current = loadCustomStrategies()
  const existing = current.find((item) => item.id === id)
  const next: StoredStrategyDraft = {
    id,
    name: draft.name,
    draft,
    source: "strategy-lab",
    status: existing?.report ? "backtested" : "queued",
    report: existing?.report,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  saveCustomStrategies([next, ...current.filter((item) => item.id !== id)].slice(0, 24))
  return next
}

export function saveCustomStrategyReport(id: string, report: BacktestReport) {
  const current = loadCustomStrategies()
  const updated = current.map((item) =>
    item.id === id
      ? { ...item, report, status: "backtested" as const, error: undefined, updatedAt: new Date().toISOString() }
      : item,
  )
  saveCustomStrategies(updated)
  return updated
}

export function saveCustomStrategyError(id: string, error: string) {
  const current = loadCustomStrategies()
  const updated = current.map((item) =>
    item.id === id
      ? { ...item, status: "failed" as const, error, updatedAt: new Date().toISOString() }
      : item,
  )
  saveCustomStrategies(updated)
  return updated
}

export function strategyDraftToBacktestReport(rawItem: StoredStrategyDraft): BacktestReport {
  const draft = normalizeStrategyDraft(rawItem.draft, rawItem.name)
  const item: StoredStrategyDraft = {
    ...rawItem,
    name: typeof rawItem.name === "string" && rawItem.name ? rawItem.name : draft.name,
    draft,
    status: normalizeStoredStatus(rawItem.status),
    createdAt: validDateString(rawItem.createdAt) ?? validDateString(rawItem.updatedAt) ?? new Date().toISOString(),
    updatedAt: validDateString(rawItem.updatedAt) ?? new Date().toISOString(),
  }
  if (isBacktestReportLike(rawItem.report)) return normalizeBacktestReport(rawItem.report, item)
  const now = item.updatedAt || new Date().toISOString()
  const factorIds = extractDraftFactorIds(item.draft)
  const issue = item.error ?? "策略实验室草稿已导入，正在提交 Qveris 历史 K 线回测。"
  const admission: StrategyAdmission = {
    status: "blocked",
    gate: "禁止入雷达",
    score: 0,
    tags: item.status === "failed" ? ["回测失败"] : ["等待回测"],
    reason: issue,
  }

  return {
    strategyId: item.id,
    title: "真实历史回测",
    strategyName: item.name,
    backtestSource: "Qveris K线代理",
    period: { start: "", end: "", days: 0 },
    universe: item.draft.dsl.universe || item.draft.market || "自定义股票池",
    benchmark: "等权股票池",
    dataSource: {
      source: "mock",
      qverisCount: 0,
      total: 0,
      fallbackReason: issue,
      finishedAt: now,
    },
    factorDataPlan: buildFactorDataPlanForDraft(item.draft),
    parameters: {
      lookbackDays: 250,
      momentumWindow: 70,
      rebalanceDays: parseRebalanceDays(item.draft.dsl.rebalance),
      topN: 3,
      feeRate: 0.001,
    },
    metrics: [
      { label: "策略收益", value: "回测中", tone: "neutral" },
      { label: "策略年化收益", value: "回测中", tone: "neutral" },
      { label: "超额收益", value: "回测中", tone: "neutral" },
      { label: "基准收益", value: "回测中", tone: "neutral" },
      { label: "阿尔法", value: "回测中", tone: "neutral" },
      { label: "贝塔", value: "回测中", tone: "neutral" },
    ],
    curve: [],
    trades: [],
    positionTrades: [],
    diagnosis: {
      verdict: "需要修正后复测",
      score: item.draft.backtestReadiness.score,
      headline: issue,
      tags: admission.tags,
      admission,
      checks: [
        {
          label: "导入状态",
          value: item.status === "failed" ? "失败" : "排队中",
          tone: item.status === "failed" ? "bad" : "warning",
          note: item.status === "failed" ? issue : "页面会自动提交真实历史 K 线回测，完成后刷新本条报告。",
        },
        {
          label: "因子数量",
          value: `${factorIds.length}`,
          tone: factorIds.length ? "neutral" : "warning",
          note: factorIds.length ? factorIds.join(" / ") : "没有可解析的因子排序，回测会退回到动量代理。",
        },
      ],
      recommendations: item.draft.nextSteps.length
        ? item.draft.nextSteps
        : ["确认因子、股票池、调仓频率和风控参数后重新运行真实回测。"],
      topWinners: [],
      topLosers: [],
    },
    logs: [
      `策略实验室导入：${formatBeijingDateTime(now, { seconds: true })}`,
      `因子：${factorIds.length ? factorIds.join(" / ") : "待解析"}`,
      issue,
    ],
  }
}

export function storedStrategyToCatalogStrategy(item: StoredStrategyDraft): Strategy {
  const report = item.report ?? strategyDraftToBacktestReport(item)
  const factorIds = extractDraftFactorIds(item.draft)
  const admission = normalizeAdmission(report)
  const annualReturn = metricNumber(report, "策略年化收益")
  const maxDrawdown = Math.abs(metricNumber(report, "最大回撤"))
  const sharpe = metricNumber(report, "夏普比率")
  const winRate = metricNumber(report, "胜率")
  const freq = item.draft.timeframe.includes("分钟") || item.draft.timeframe.includes("日内")
    ? "intraday"
    : item.draft.timeframe.includes("月") || item.draft.timeframe.includes("中长")
      ? "position"
      : "swing"

  return {
    id: report.strategyId,
    name: item.name,
    author: "我的策略库",
    desc: item.draft.summary,
    factors: factorIds.length ? factorIds : ["f-mom-60d"],
    freq,
    annualReturn,
    maxDrawdown,
    sharpe,
    winRate,
    backtestStatus: item.status === "backtested" ? "真实回测" : "待真实回测",
    backtestSource: report.backtestSource ?? "Qveris K线代理",
    status: "私有",
    subscribers: 1,
    admission,
    rankScore: strategyRankScore(report),
    lastBacktestedAt: report.dataSource.finishedAt || item.updatedAt,
  }
}

function buildStrategyDraftId(draft: StrategyDraft) {
  return `lab-${slug(draft.name)}-${shortHash(JSON.stringify(draft.dsl))}`
}

function extractDraftFactorIds(draft: StrategyDraft) {
  const ids = new Set<string>()
  for (const item of draft.dsl.ranking) {
    const id = item.trim().split(/\s+/)[0]
    if (id) ids.add(id)
  }
  for (const item of draft.factorMap) {
    if (item.factorId) ids.add(item.factorId)
  }
  return Array.from(ids)
}

function parseRebalanceDays(value: string) {
  const match = value.match(/(\d+)/)
  if (!match) return 5
  return Math.max(1, Math.min(30, Number(match[1]) || 5))
}

function metricNumber(report: BacktestReport, label: string) {
  const value = report.metrics.find((item) => item.label === label)?.value ?? "0"
  const parsed = Number(value.replace("%", "").replace(/[+,]/g, ""))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

function strategyRankScore(report: BacktestReport) {
  const annual = metricNumber(report, "策略年化收益")
  const excess = metricNumber(report, "超额收益")
  const drawdown = Math.abs(metricNumber(report, "最大回撤"))
  const sharpe = metricNumber(report, "夏普比率")
  const winRate = metricNumber(report, "胜率")
  const admission = normalizeAdmission(report)
  const gateBonus = admission.status === "radar-ready" ? 20 : admission.status === "watchlist" ? 6 : -12
  return Math.round((admission.score + annual * 0.18 + excess * 0.28 + sharpe * 5 + (winRate - 50) * 0.25 - drawdown * 0.35 + gateBonus) * 100) / 100
}

function normalizeAdmission(report: BacktestReport): StrategyAdmission {
  if (isStrategyAdmission(report.diagnosis?.admission)) return report.diagnosis.admission
  return {
    status: "blocked",
    gate: "禁止入雷达",
    score: report.diagnosis?.score ?? 0,
    tags: report.diagnosis?.tags?.length ? report.diagnosis.tags : ["待复测"],
    reason: "旧版回测报告缺少雷达准入信息，请重新运行真实回测。",
  }
}

function normalizeStoredStrategyDraft(value: unknown): StoredStrategyDraft | null {
  if (!value || typeof value !== "object") return null
  const obj = value as Partial<StoredStrategyDraft>
  if (typeof obj.id !== "string" || !obj.id) return null
  const draft = normalizeStrategyDraft(obj.draft, typeof obj.name === "string" ? obj.name : obj.id)
  const updatedAt = validDateString(obj.updatedAt) ?? new Date().toISOString()
  const item: StoredStrategyDraft = {
    id: obj.id,
    name: typeof obj.name === "string" && obj.name ? obj.name : draft.name,
    draft,
    status: normalizeStoredStatus(obj.status),
    source: "strategy-lab",
    createdAt: validDateString(obj.createdAt) ?? updatedAt,
    updatedAt,
    error: typeof obj.error === "string" ? obj.error : undefined,
  }
  return {
    ...item,
    report: isBacktestReportLike(obj.report) ? normalizeBacktestReport(obj.report, item) : undefined,
  }
}

function normalizeBacktestReport(value: BacktestReport, item: StoredStrategyDraft): BacktestReport {
  const report = value as Partial<BacktestReport>
  const fallback = pendingBacktestReport(item)
  const diagnosis = normalizeDiagnosis(report.diagnosis, item)

  return {
    strategyId: stringValue(report.strategyId, item.id),
    title: stringValue(report.title, fallback.title),
    strategyName: stringValue(report.strategyName, item.name),
    backtestSource: report.backtestSource ?? fallback.backtestSource,
    period: isRecord(report.period)
      ? {
          start: stringValue(report.period.start, ""),
          end: stringValue(report.period.end, ""),
          days: numberValue(report.period.days, 0),
        }
      : fallback.period,
    universe: stringValue(report.universe, fallback.universe),
    benchmark: stringValue(report.benchmark, fallback.benchmark),
    dataSource: isRecord(report.dataSource)
      ? {
          source: report.dataSource.source === "qveris" || report.dataSource.source === "mixed" || report.dataSource.source === "mock"
            ? report.dataSource.source
            : fallback.dataSource.source,
          qverisCount: numberValue(report.dataSource.qverisCount, 0),
          databaseCount: numberValue(report.dataSource.databaseCount, undefined),
          total: numberValue(report.dataSource.total, 0),
          fallbackReason: typeof report.dataSource.fallbackReason === "string" ? report.dataSource.fallbackReason : undefined,
          finishedAt: validDateString(report.dataSource.finishedAt) ?? item.updatedAt,
        }
      : fallback.dataSource,
    factorDataPlan: report.factorDataPlan ?? fallback.factorDataPlan,
    parameters: isRecord(report.parameters)
      ? {
          lookbackDays: numberValue(report.parameters.lookbackDays, fallback.parameters.lookbackDays),
          momentumWindow: numberValue(report.parameters.momentumWindow, fallback.parameters.momentumWindow),
          rebalanceDays: numberValue(report.parameters.rebalanceDays, fallback.parameters.rebalanceDays),
          topN: numberValue(report.parameters.topN, fallback.parameters.topN),
          feeRate: numberValue(report.parameters.feeRate, fallback.parameters.feeRate),
        }
      : fallback.parameters,
    metrics: Array.isArray(report.metrics) ? report.metrics.filter(isMetricLike) : fallback.metrics,
    curve: Array.isArray(report.curve) ? report.curve.filter(isRecord) as BacktestReport["curve"] : fallback.curve,
    trades: Array.isArray(report.trades) ? report.trades.filter(isRecord) as BacktestReport["trades"] : fallback.trades,
    positionTrades: Array.isArray(report.positionTrades) ? report.positionTrades.filter(isRecord) as BacktestReport["positionTrades"] : fallback.positionTrades,
    diagnosis,
    logs: Array.isArray(report.logs) && report.logs.length ? report.logs.filter((line): line is string => typeof line === "string") : fallback.logs,
  }
}

function pendingBacktestReport(item: StoredStrategyDraft): BacktestReport {
  return strategyDraftToBacktestReport({ ...item, report: undefined })
}

function normalizeDiagnosis(value: unknown, item: StoredStrategyDraft): BacktestReport["diagnosis"] {
  const diagnosis = isRecord(value) ? value : {}
  const admission = normalizeAdmissionShape(diagnosis.admission, diagnosis.score, diagnosis.tags)
  return {
    verdict: diagnosis.verdict === "可继续小样本跟踪" || diagnosis.verdict === "需要修正后复测" || diagnosis.verdict === "暂不适合上线"
      ? diagnosis.verdict
      : "需要修正后复测",
    score: numberValue(diagnosis.score, admission.score),
    headline: stringValue(diagnosis.headline, admission.reason),
    tags: stringArray(diagnosis.tags, admission.tags),
    admission,
    checks: Array.isArray(diagnosis.checks) ? diagnosis.checks.filter(isRecord) as BacktestReport["diagnosis"]["checks"] : [],
    recommendations: stringArray(diagnosis.recommendations, item.draft.nextSteps.length ? item.draft.nextSteps : ["旧版本地回测缓存已兼容展示，建议重新运行真实回测。"]),
    topWinners: Array.isArray(diagnosis.topWinners) ? diagnosis.topWinners.filter(isRecord) as BacktestReport["diagnosis"]["topWinners"] : [],
    topLosers: Array.isArray(diagnosis.topLosers) ? diagnosis.topLosers.filter(isRecord) as BacktestReport["diagnosis"]["topLosers"] : [],
    drawdownHotspot: isRecord(diagnosis.drawdownHotspot)
      ? {
          date: stringValue(diagnosis.drawdownHotspot.date, ""),
          drawdownPct: numberValue(diagnosis.drawdownHotspot.drawdownPct, 0),
          holdings: stringValue(diagnosis.drawdownHotspot.holdings, ""),
        }
      : undefined,
  }
}

function normalizeAdmissionShape(value: unknown, score: unknown, tags: unknown): StrategyAdmission {
  if (isStrategyAdmission(value)) return value
  return {
    status: "blocked",
    gate: "禁止入雷达",
    score: numberValue(score, 0),
    tags: stringArray(tags, ["待复测"]),
    reason: "旧版本地回测缓存缺少雷达准入信息，已自动降级为待复测状态。",
  }
}

function isStrategyAdmission(value: unknown): value is StrategyAdmission {
  if (!isRecord(value)) return false
  return (
    (value.status === "radar-ready" || value.status === "watchlist" || value.status === "blocked") &&
    typeof value.gate === "string" &&
    typeof value.score === "number" &&
    Array.isArray(value.tags) &&
    typeof value.reason === "string"
  )
}

function isBacktestReportLike(value: unknown): value is BacktestReport {
  return isRecord(value) && typeof value.strategyId === "string" && typeof value.strategyName === "string"
}

function normalizeStrategyDraft(value: unknown, fallbackName: string): StrategyDraft {
  const draft = isRecord(value) ? value : {}
  const dsl = isRecord(draft.dsl) ? draft.dsl : {}
  return {
    name: stringValue(draft.name, fallbackName || "自定义策略"),
    summary: stringValue(draft.summary, "旧版本地策略草稿"),
    market: stringValue(draft.market, "A 股"),
    timeframe: stringValue(draft.timeframe, "日线"),
    entryRules: stringArray(draft.entryRules, []),
    exitRules: stringArray(draft.exitRules, []),
    riskRules: stringArray(draft.riskRules, []),
    positionRules: stringArray(draft.positionRules, []),
    factorMap: Array.isArray(draft.factorMap) ? draft.factorMap.filter(isRecord) as StrategyDraft["factorMap"] : [],
    dsl: {
      universe: stringValue(dsl.universe, "自定义股票池"),
      frequency: stringValue(dsl.frequency, "日线"),
      ranking: stringArray(dsl.ranking, []),
      entry: stringArray(dsl.entry, []),
      exit: stringArray(dsl.exit, []),
      risk: stringArray(dsl.risk, []),
      position: stringArray(dsl.position, []),
      rebalance: stringValue(dsl.rebalance, "5 日"),
    },
    backtestReadiness: isRecord(draft.backtestReadiness)
      ? {
          score: numberValue(draft.backtestReadiness.score, 0),
          ready: Boolean(draft.backtestReadiness.ready),
          issues: stringArray(draft.backtestReadiness.issues, []),
          requiredData: stringArray(draft.backtestReadiness.requiredData, []),
        }
      : { score: 0, ready: false, issues: ["旧版草稿缺少回测准备度"], requiredData: [] },
    nextSteps: stringArray(draft.nextSteps, []),
    source: draft.source === "ai" || draft.source === "heuristic" ? draft.source : "heuristic",
    research: isRecord(draft.research) ? draft.research as StrategyDraft["research"] : undefined,
  }
}

function normalizeStoredStatus(value: unknown): StoredStrategyDraft["status"] {
  return value === "backtested" || value === "failed" || value === "queued" ? value : "queued"
}

function isMetricLike(value: unknown): value is BacktestReport["metrics"][number] {
  return isRecord(value) && typeof value.label === "string" && typeof value.value === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback
}

function numberValue<T extends number | undefined>(value: unknown, fallback: T): number | T {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function validDateString(value: unknown) {
  if (typeof value !== "string") return undefined
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? value : undefined
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "strategy"
}

function shortHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).slice(0, 8)
}
