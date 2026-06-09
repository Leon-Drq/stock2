import { runStrategyBacktestReportsForStrategies, type BacktestReport } from "@/lib/backtest"
import type { Strategy } from "@/lib/catalog"
import { STRATEGY_CATALOG_MIN_ANNUAL_RETURN } from "@/lib/catalog"
import { DEFAULT_STRATEGY_MINER_QUERIES, type StrategyMinerConfig } from "@/lib/strategy-miner-config"
import { syncStrategyMiningReport, type StrategyMinerStoreResult } from "@/lib/strategy-miner-store"
import { syncStrategyRegistryFromMiningCandidates } from "@/lib/strategy-registry-store"

type CandidateSourceKind = "github" | "curated"

export type StrategyMiningSource = {
  kind: CandidateSourceKind
  name: string
  url: string
  query?: string
  stars?: number
  language?: string
  license?: string
}

export type StrategyMiningCandidateStatus = "promoted" | "watchlist" | "rejected" | "untested"

export type StrategyResearchPlan = {
  archetype: "突破" | "趋势" | "回踩" | "均值回归" | "资金事件" | "日内" | "防守"
  evidence: string
  promotionPath: "雷达候选" | "模拟观察" | "数据补齐后复测" | "实验室保留"
  dataNeeds: string[]
  antiOverfitChecks: string[]
}

export type StrategyMiningCandidate = {
  candidateId: string
  strategy: Strategy
  source: StrategyMiningSource
  hypothesis: string
  research: StrategyResearchPlan
  dsl: {
    universe: string
    rebalance: string
    ranking: string[]
    risk: string[]
    source: string
  }
  status: StrategyMiningCandidateStatus
  discoveredAt: string
  incubation?: StrategyIncubation
  report?: BacktestReport
  metrics?: {
    annualReturn: number
    totalReturn: number
    excessReturn: number
    maxDrawdown: number
    sharpe: number
    winRate: number
  }
  raw: Record<string, unknown>
}

export type StrategyIncubation = {
  score: number
  gate: "雷达候选" | "模拟观察" | "修正复测" | "淘汰"
  overfitRisk: "low" | "medium" | "high"
  marketCoverage: number
  walkForward: {
    inSampleAnnualReturn: number
    outSampleAnnualReturn: number
    decayPct: number
    pass: boolean
  }
  regimes: Array<{
    name: "强势" | "震荡" | "弱势"
    days: number
    strategyReturn: number
    benchmarkReturn: number
    excessReturn: number
    hitRate: number
  }>
  parameterGrid: Array<{
    name: string
    score: number
    status: "pass" | "watch" | "fail"
    note: string
  }>
  blockers: string[]
  nextActions: string[]
}

export type StrategyMiningReport = {
  generatedAt: string
  candidates: StrategyMiningCandidate[]
  summary: {
    sources: number
    candidates: number
    backtested: number
    promoted: number
    watchlist: number
    rejected: number
    github: number
    curated: number
  }
  notes: string[]
  store: StrategyMinerStoreResult
}

export type StrategyMiningOptions = {
  maxCandidates?: number
  githubLimitPerQuery?: number
  immediateBacktestLimit?: number
  persist?: boolean
  config?: StrategyMinerConfig
}

type CandidateTemplate = {
  id: string
  name: string
  author: string
  desc: string
  factors: string[]
  freq: Strategy["freq"]
  hypothesis: string
  source: StrategyMiningSource
  risk: string[]
}

type GithubRepo = {
  id: number
  full_name: string
  html_url: string
  description: string | null
  stargazers_count: number
  language: string | null
  topics?: string[]
  license?: { spdx_id?: string | null; name?: string | null } | null
}

const CURATED_TEMPLATES: CandidateTemplate[] = [
  {
    id: "mine-curated-donchian-breakout",
    name: "Donchian 通道突破候选",
    author: "Stock2 Curated",
    desc: "从 Turtle/Donchian 公开趋势突破思想转译，优先测试 55 日通道突破、波动收缩和绝对动量过滤。",
    factors: ["f-donchian-55", "f-atr-compression", "f-absolute-momentum"],
    freq: "position",
    hypothesis: "中期突破策略在 A 股需要叠加绝对动量和波动收缩，降低假突破和弱市回撤。",
    source: {
      kind: "curated",
      name: "Turtle / Donchian breakout",
      url: "https://en.wikipedia.org/wiki/Turtle_trading",
      query: "turtle donchian breakout trend following",
    },
    risk: ["绝对动量过滤", "通道突破失败退出", "20 日调仓", "组合级回撤保护"],
  },
  {
    id: "mine-curated-rsi2-pullback",
    name: "RSI2 趋势回踩候选",
    author: "Stock2 Curated",
    desc: "从 RSI2/Connors 短线回归思想转译，只在长期趋势保护下测试超卖回补。",
    factors: ["f-pullback-uptrend", "f-rsi2-reversal", "f-absolute-momentum"],
    freq: "swing",
    hypothesis: "短线超卖策略不能只看胜率，必须用长期趋势过滤和交易成本验证盈亏比。",
    source: {
      kind: "curated",
      name: "RSI mean reversion",
      url: "https://en.wikipedia.org/wiki/Relative_strength_index",
      query: "rsi2 connors mean reversion pullback",
    },
    risk: ["趋势过滤", "短线回补失败即退出", "高换手降级", "弱市空仓"],
  },
  {
    id: "mine-curated-bollinger-reversion",
    name: "Bollinger 趋势回归候选",
    author: "Stock2 Curated",
    desc: "从布林带均值回归策略转译，先加入趋势保护，避免在下跌通道中接连续弱势。",
    factors: ["f-bollinger-revert", "f-rsi2-reversal", "f-absolute-momentum"],
    freq: "swing",
    hypothesis: "布林回归策略需要重点检查极端行情回撤、交易成本和连续补跌风险。",
    source: {
      kind: "curated",
      name: "Bollinger Bands",
      url: "https://en.wikipedia.org/wiki/Bollinger_Bands",
      query: "bollinger bands mean reversion trading strategy",
    },
    risk: ["趋势过滤", "极端回撤降级", "不追逐单日反弹", "亏损样本复盘"],
  },
  {
    id: "mine-curated-macd-trend",
    name: "MACD 风险调整趋势候选",
    author: "Stock2 Curated",
    desc: "从 MACD 趋势跟随策略转译，叠加风险调整动量和弱市空仓，减少单指标噪音。",
    factors: ["f-macd-trend", "f-risk-adjusted-mom", "f-absolute-momentum"],
    freq: "position",
    hypothesis: "MACD 单因子在震荡市噪音较大，需要结合动量质量和市场状态后再进入雷达。",
    source: {
      kind: "curated",
      name: "MACD trend following",
      url: "https://en.wikipedia.org/wiki/MACD",
      query: "macd trend following trading strategy",
    },
    risk: ["弱市空仓", "20 日调仓", "回撤触发降仓", "参数窗口压力测试"],
  },
  {
    id: "mine-curated-low-vol-momentum",
    name: "低波动动量候选",
    author: "Stock2 Curated",
    desc: "从动量投资和低波动组合思想转译，优先选择中期强势且波动受控的标的。",
    factors: ["f-low-vol-mom", "f-mom-60d", "f-absolute-momentum"],
    freq: "position",
    hypothesis: "风险调整后的动量比单纯追涨更适合进入模拟盘观察，核心风险是行情急转时的回撤。",
    source: {
      kind: "curated",
      name: "Momentum investing",
      url: "https://www.investopedia.com/terms/m/momentum_investing.asp",
      query: "risk adjusted momentum low volatility stock strategy",
    },
    risk: ["弱市空仓", "降低高波动拥挤股权重", "组合分散", "样本外复测"],
  },
  {
    id: "mine-curated-minervini-trend",
    name: "Minervini 趋势模板候选",
    author: "Stock2 Curated",
    desc: "从趋势模板选股思想转译，测试均线多头、52 周高位和放量突破后的持续性。",
    factors: ["f-minervini-trend", "f-vol-spike", "f-absolute-momentum"],
    freq: "position",
    hypothesis: "强势趋势模板适合作为雷达候选源，但必须拦截高位放量失败和弱市集中回撤。",
    source: {
      kind: "curated",
      name: "Trend template",
      url: "https://www.investopedia.com/terms/m/momentum_investing.asp",
      query: "minervini trend template stock strategy",
    },
    risk: ["52 周高位不过度追高", "放量突破失败退出", "弱市降仓", "单票上限"],
  },
]

export async function runStrategyMining(options: StrategyMiningOptions = {}): Promise<StrategyMiningReport> {
  const generatedAt = new Date().toISOString()
  const githubLimitPerQuery = options.githubLimitPerQuery ?? options.config?.githubLimitPerQuery ?? 4
  const maxCandidates = options.maxCandidates ?? options.config?.maxCandidates ?? 18
  const queries = options.config?.queries ?? DEFAULT_STRATEGY_MINER_QUERIES
  const githubEnabled = options.config?.githubEnabled ?? process.env.STRATEGY_MINER_DISABLE_GITHUB !== "1"
  const notes = miningBaseNotes()
  const candidates = await collectStrategyMiningCandidates(generatedAt, notes, githubLimitPerQuery, maxCandidates, queries, githubEnabled)
  const immediateBacktestLimit = Math.max(
    0,
    Math.min(candidates.length, options.immediateBacktestLimit ?? options.config?.immediateBacktestLimit ?? candidates.length),
  )
  const immediateCandidates = candidates.slice(0, immediateBacktestLimit)
  const queuedCandidates = candidates.slice(immediateBacktestLimit)

  const batch = immediateCandidates.length > 0
    ? await runStrategyBacktestReportsForStrategies(
        immediateCandidates.map((candidate) => candidate.strategy),
        { notes: ["策略矿工候选已统一使用 Qveris/Supabase 历史 K 线回测。"] },
      )
    : { reports: [], notes: ["本轮只发现待排队候选，未立即启动同步回测。"] }
  const reportById = new Map(batch.reports.map((report) => [report.strategyId, report]))
  const evaluated = [
    ...immediateCandidates.map((candidate) => evaluateCandidate(candidate, reportById.get(candidate.strategy.id))),
    ...queuedCandidates.map((candidate) => ({ ...candidate, status: "untested" as const })),
  ]
  if (queuedCandidates.length > 0) {
    notes.push(`本轮发现 ${queuedCandidates.length} 个候选已进入待回测队列，后台任务会逐个复测。`)
  }
  const summary = summarizeCandidates(evaluated)

  const report: StrategyMiningReport = {
    generatedAt,
    candidates: evaluated.sort(candidateSort),
    summary,
    notes: [...notes, ...batch.notes],
    store: { driver: "memory", persisted: false },
  }
  report.store = options.persist === false ? report.store : await syncStrategyMiningReport(report)
  await syncMiningReportsToRegistry(report)
  return report
}

export async function runStrategyMiningCandidateBacktest(
  strategyId: string,
  options: StrategyMiningOptions = {},
): Promise<{ generatedAt: string; candidate?: StrategyMiningCandidate; notes: string[]; store: StrategyMinerStoreResult }> {
  const generatedAt = new Date().toISOString()
  const notes = miningBaseNotes()
  const curated = CURATED_TEMPLATES.find((template) => template.id === strategyId)
  const githubLimitPerQuery = options.githubLimitPerQuery ?? options.config?.githubLimitPerQuery ?? 4
  const maxCandidates = options.maxCandidates ?? options.config?.maxCandidates ?? 24
  const candidates = curated
    ? [templateToCandidate(curated, generatedAt)]
    : await collectStrategyMiningCandidates(
        generatedAt,
        notes,
        githubLimitPerQuery,
        maxCandidates,
        options.config?.queries ?? DEFAULT_STRATEGY_MINER_QUERIES,
        options.config?.githubEnabled ?? process.env.STRATEGY_MINER_DISABLE_GITHUB !== "1",
      )
  const candidate = candidates.find((item) => item.strategy.id === strategyId)
  if (!candidate) {
    return {
      generatedAt,
      notes: [...notes, `未找到策略矿工候选 ${strategyId}。可先刷新策略矿工页面重新发现候选。`],
      store: { driver: "memory", persisted: false },
    }
  }

  const batch = await runStrategyBacktestReportsForStrategies([candidate.strategy], {
    notes: ["策略矿工详情页仅回测当前候选，避免一次加载所有曲线。"],
  })
  const evaluated = evaluateCandidate(candidate, batch.reports[0])
  const report: StrategyMiningReport = {
    generatedAt,
    candidates: [evaluated],
    summary: summarizeCandidates([evaluated]),
    notes: [...notes, ...batch.notes],
    store: { driver: "memory", persisted: false },
  }
  report.store = options.persist === false ? report.store : await syncStrategyMiningReport(report)
  await syncMiningReportsToRegistry(report)
  return { generatedAt, candidate: evaluated, notes: report.notes, store: report.store }
}

async function syncMiningReportsToRegistry(report: StrategyMiningReport) {
  try {
    const result = await syncStrategyRegistryFromMiningCandidates(report.candidates)
    if (result.entries.length > 0) {
      report.notes.push(`策略注册表已同步 ${result.entries.length} 个矿工候选，新增/保留待回测任务 ${result.queuedJobs.length} 个。`)
    }
  } catch (error) {
    report.notes.push(`策略注册表同步失败：${error instanceof Error ? error.message : String(error)}。`)
  }
}

export function compactStrategyMiningReport(report: StrategyMiningReport): StrategyMiningReport {
  return {
    ...report,
    candidates: report.candidates.map((candidate) => {
      if (!candidate.report) return candidate
      return {
        ...candidate,
        report: {
          ...candidate.report,
          curve: candidate.report.curve.slice(-5),
          trades: candidate.report.trades.slice(0, 5),
          positionTrades: [],
          diagnosis: {
            ...candidate.report.diagnosis,
            topWinners: candidate.report.diagnosis.topWinners.slice(0, 3),
            topLosers: candidate.report.diagnosis.topLosers.slice(0, 3),
          },
          logs: candidate.report.logs.slice(0, 4),
        },
      }
    }),
  }
}

async function collectStrategyMiningCandidates(
  generatedAt: string,
  notes: string[],
  githubLimitPerQuery: number,
  maxCandidates: number,
  queries: string[] = DEFAULT_STRATEGY_MINER_QUERIES,
  githubEnabled = process.env.STRATEGY_MINER_DISABLE_GITHUB !== "1",
) {
  const githubRepos = await discoverGithubRepos(githubLimitPerQuery, queries, githubEnabled).catch((error) => {
    notes.push(`GitHub 搜索暂时失败：${error instanceof Error ? error.message : String(error)}。已使用内置公开策略模板继续回测。`)
    return [] as Array<{ repo: GithubRepo; query: string }>
  })
  return dedupeCandidates([
    ...CURATED_TEMPLATES.map((template) => templateToCandidate(template, generatedAt)),
    ...githubRepos.map(({ repo, query }) => githubRepoToCandidate(repo, query, generatedAt)),
  ]).slice(0, maxCandidates)
}

function miningBaseNotes() {
  return [
    "外部策略只作为规则灵感，不执行第三方代码；系统统一转成内部因子 DSL 后回测。",
    `准入门槛沿用策略目录：真实回测年化至少 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%，并检查回撤、换手、样本和因子真实性。`,
  ]
}

function summarizeCandidates(evaluated: StrategyMiningCandidate[]): StrategyMiningReport["summary"] {
  return {
    sources: new Set(evaluated.map((candidate) => candidate.source.url)).size,
    candidates: evaluated.length,
    backtested: evaluated.filter((candidate) => Boolean(candidate.report?.curve.length)).length,
    promoted: evaluated.filter((candidate) => candidate.status === "promoted").length,
    watchlist: evaluated.filter((candidate) => candidate.status === "watchlist").length,
    rejected: evaluated.filter((candidate) => candidate.status === "rejected").length,
    github: evaluated.filter((candidate) => candidate.source.kind === "github").length,
    curated: evaluated.filter((candidate) => candidate.source.kind === "curated").length,
  }
}

async function discoverGithubRepos(limitPerQuery: number, queries: string[], githubEnabled: boolean) {
  if (!githubEnabled || process.env.STRATEGY_MINER_DISABLE_GITHUB === "1") return []
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "stock-radar-strategy-miner",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const out: Array<{ repo: GithubRepo; query: string }> = []
  for (const query of queries) {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limitPerQuery}`
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 3600 },
    })
    if (!response.ok) throw new Error(`GitHub search ${response.status}`)
    const json = await response.json() as { items?: GithubRepo[] }
    for (const repo of json.items ?? []) out.push({ repo, query })
  }
  return out
}

function templateToCandidate(template: CandidateTemplate, discoveredAt: string): StrategyMiningCandidate {
  return {
    candidateId: template.id,
    strategy: {
      id: template.id,
      name: template.name,
      author: template.author,
      desc: template.desc,
      factors: template.factors,
      freq: template.freq,
      annualReturn: 0,
      maxDrawdown: 0,
      sharpe: 0,
      winRate: 0,
      backtestStatus: "真实回测",
      backtestSource: template.factors.every(isDirectPriceFactor) ? "Qveris" : "Qveris K线代理",
      status: "审核中",
      subscribers: 0,
    },
    source: template.source,
    hypothesis: template.hypothesis,
    research: buildResearchPlan(template.id, template.factors, template.freq, template.source, template.risk),
    dsl: buildDsl(template.factors, template.freq, template.risk, template.source.name),
    status: "untested",
    discoveredAt,
    raw: { template: true },
  }
}

function githubRepoToCandidate(repo: GithubRepo, query: string, discoveredAt: string): StrategyMiningCandidate {
  const template = classifyRepo(repo)
  const source: StrategyMiningSource = {
    kind: "github",
    name: repo.full_name,
    url: repo.html_url,
    query,
    stars: repo.stargazers_count,
    language: repo.language ?? undefined,
    license: repo.license?.spdx_id ?? repo.license?.name ?? undefined,
  }
  const id = `mine-gh-${template.key}-${shortHash(repo.full_name)}`
  return {
    candidateId: id,
    strategy: {
      id,
      name: `${template.name} · ${repo.full_name.split("/").at(-1) ?? "GitHub"}`,
      author: repo.full_name,
      desc: `${template.desc} 来源仓库描述：${repo.description ?? "未提供描述"}。`,
      factors: template.factors,
      freq: template.freq,
      annualReturn: 0,
      maxDrawdown: 0,
      sharpe: 0,
      winRate: 0,
      backtestStatus: "真实回测",
      backtestSource: template.factors.every(isDirectPriceFactor) ? "Qveris" : "Qveris K线代理",
      status: "审核中",
      subscribers: 0,
    },
    source,
    hypothesis: template.hypothesis,
    research: buildResearchPlan(id, template.factors, template.freq, source, template.risk),
    dsl: buildDsl(template.factors, template.freq, template.risk, repo.full_name),
    status: "untested",
    discoveredAt,
    raw: {
      githubId: repo.id,
      topics: repo.topics ?? [],
      description: repo.description,
      stars: repo.stargazers_count,
    },
  }
}

function classifyRepo(repo: GithubRepo) {
  const text = `${repo.full_name} ${repo.description ?? ""} ${(repo.topics ?? []).join(" ")}`.toLowerCase()
  if (/rsi|connors|mean.?reversion|reversion|oversold|超卖|回归/.test(text)) {
    return {
      key: "rsi2-pullback",
      name: "RSI2 回踩候选",
      desc: "从 GitHub 均值回归/RSI 策略抽取，只在长期趋势保护下测试短线超卖回补。",
      factors: ["f-pullback-uptrend", "f-rsi2-reversal", "f-absolute-momentum"],
      freq: "swing" as const,
      hypothesis: "RSI 类策略需要用真实交易成本验证盈亏比，不能只看胜率。",
      risk: ["趋势过滤", "短线回补失败即调仓退出", "高换手降级"],
    }
  }
  if (/macd/.test(text)) {
    return {
      key: "macd-trend",
      name: "MACD 趋势候选",
      desc: "从 GitHub MACD 策略抽取，叠加风险调整动量和弱市空仓。",
      factors: ["f-macd-trend", "f-risk-adjusted-mom", "f-absolute-momentum"],
      freq: "position" as const,
      hypothesis: "MACD 单因子噪音较大，需要组合动量和风控过滤后再上线。",
      risk: ["弱市空仓", "20 日调仓", "回撤触发降仓"],
    }
  }
  if (/bollinger|bbands|布林/.test(text)) {
    return {
      key: "bollinger-revert",
      name: "Bollinger 回归候选",
      desc: "从 GitHub 布林策略抽取，先用趋势过滤避免下跌通道中接刀。",
      factors: ["f-bollinger-revert", "f-rsi2-reversal", "f-absolute-momentum"],
      freq: "swing" as const,
      hypothesis: "布林回归策略要重点检查极端行情回撤和交易成本。",
      risk: ["趋势过滤", "极端回撤降级", "不追逐单日反弹"],
    }
  }
  if (/turtle|donchian|channel|breakout|突破|通道/.test(text)) {
    return {
      key: "donchian-breakout",
      name: "Donchian 突破候选",
      desc: "从 GitHub 趋势突破策略抽取，用通道突破、ATR 收缩和绝对动量组合回测。",
      factors: ["f-donchian-55", "f-atr-compression", "f-absolute-momentum"],
      freq: "position" as const,
      hypothesis: "突破策略可作为雷达候选源，但必须用回撤和换手门槛拦截假突破。",
      risk: ["绝对动量过滤", "通道突破失败退出", "组合级回撤保护"],
    }
  }
  return {
    key: "risk-adjusted-momentum",
    name: "风险调整动量候选",
    desc: "从 GitHub 量化/多因子仓库抽取，先落成可审计的动量-低波动组合。",
    factors: ["f-risk-adjusted-mom", "f-low-vol-mom", "f-mom-60d", "f-absolute-momentum"],
    freq: "position" as const,
    hypothesis: "公开多因子仓库先按可由 K 线复现的动量/低波动代理回测，避免外部不可验证字段。",
    risk: ["弱市空仓", "降低高波动拥挤股权重", "样本外复测前不入雷达"],
  }
}

function buildDsl(factors: string[], freq: Strategy["freq"], risk: string[], source: string) {
  return {
    universe: "A 股扩展股票池",
    rebalance: freq === "position" ? "20 个交易日" : freq === "swing" ? "5 个交易日" : "1 个交易日",
    ranking: factors,
    risk,
    source,
  }
}

function buildResearchPlan(
  strategyId: string,
  factors: string[],
  freq: Strategy["freq"],
  source: StrategyMiningSource,
  risk: string[],
): StrategyResearchPlan {
  const hasNonPrice = factors.some((factor) => !isDirectPriceFactor(factor))
  const hasBreakout = factors.some((factor) => /breakout|donchian|tight|vol-spike|keltner|post-breakout|vcp/.test(factor))
  const hasPullback = factors.some((factor) => /pullback|rsi2|rev|bollinger/.test(factor))
  const hasFlowOrEvent = factors.some((factor) => /north|dragon|ai-flow|news|margin|canslim/.test(factor))
  const hasDefense = factors.some((factor) => /low-vol|absolute|sma200|residual/.test(factor))
  const archetype: StrategyResearchPlan["archetype"] =
    freq === "intraday"
      ? "日内"
      : hasFlowOrEvent
        ? "资金事件"
        : hasPullback
          ? "回踩"
          : hasBreakout
            ? "突破"
            : hasDefense
              ? "防守"
              : "趋势"
  const promotionPath: StrategyResearchPlan["promotionPath"] =
    freq === "intraday"
      ? "数据补齐后复测"
      : hasNonPrice
        ? "数据补齐后复测"
        : strategyId.includes("defensive") || strategyId.includes("low-vol")
          ? "模拟观察"
          : "雷达候选"

  const dataNeeds = new Set<string>(["后复权日 K 线", "成交量/成交额", "交易日历", "涨跌停/停牌过滤"])
  if (freq === "intraday") {
    dataNeeds.add("1m/5m K 线")
    dataNeeds.add("VWAP/盘口滑点")
  }
  if (hasFlowOrEvent) {
    dataNeeds.add("资金流/北向/公告/新闻原始字段")
  }
  if (factors.includes("f-canslim-proxy") || factors.includes("f-value-low-vol")) {
    dataNeeds.add("财报与估值字段")
  }

  const antiOverfitChecks = new Set([
    "样本内/样本外 60/40 walk-forward",
    "强势/震荡/弱势三行情分段",
    "参数窗口上下浮动压力测试",
    "交易成本与换手惩罚",
    ...risk.slice(0, 2),
  ])
  if (source.kind === "github") antiOverfitChecks.add("只复用规则思想，不执行第三方代码")
  if (hasNonPrice) antiOverfitChecks.add("代理因子与原始字段复测对照")

  return {
    archetype,
    evidence: source.kind === "github" ? "GitHub 公开仓库语义抽取" : "经典公开策略模板转译",
    promotionPath,
    dataNeeds: Array.from(dataNeeds).slice(0, 6),
    antiOverfitChecks: Array.from(antiOverfitChecks).slice(0, 6),
  }
}

function evaluateCandidate(candidate: StrategyMiningCandidate, report?: BacktestReport): StrategyMiningCandidate {
  if (!report || !report.curve.length) {
    return { ...candidate, status: "rejected", incubation: emptyIncubation("无有效回测曲线") }
  }
  const metrics = {
    annualReturn: metricNumber(report, "策略年化收益"),
    totalReturn: metricNumber(report, "策略收益"),
    excessReturn: metricNumber(report, "超额收益"),
    maxDrawdown: Math.abs(metricNumber(report, "最大回撤")),
    sharpe: metricNumber(report, "夏普比率"),
    winRate: metricNumber(report, "胜率"),
  }
  const admission = report.diagnosis.admission
  const status: StrategyMiningCandidateStatus =
    admission.status === "radar-ready"
      ? "promoted"
      : admission.status === "watchlist" && metrics.annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN
        ? "watchlist"
        : "rejected"
  const incubation = buildIncubation({ ...candidate, report, metrics, status }, report, metrics)
  return { ...candidate, report, metrics, status, incubation }
}

function candidateSort(a: StrategyMiningCandidate, b: StrategyMiningCandidate) {
  const statusScore = (candidate: StrategyMiningCandidate) => candidate.status === "promoted" ? 3 : candidate.status === "watchlist" ? 2 : 1
  return (
    statusScore(b) - statusScore(a) ||
    (b.report?.diagnosis.admission.score ?? 0) - (a.report?.diagnosis.admission.score ?? 0) ||
    (b.metrics?.annualReturn ?? -Infinity) - (a.metrics?.annualReturn ?? -Infinity)
  )
}

function dedupeCandidates(candidates: StrategyMiningCandidate[]) {
  const byId = new Map<string, StrategyMiningCandidate>()
  for (const candidate of candidates) {
    if (!byId.has(candidate.candidateId)) byId.set(candidate.candidateId, candidate)
  }
  return Array.from(byId.values())
}

function metricNumber(report: BacktestReport, label: string) {
  const value = report.metrics.find((item) => item.label === label)?.value ?? "0"
  const parsed = Number(value.replace("%", "").replace(/[+,]/g, ""))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

function buildIncubation(
  candidate: StrategyMiningCandidate,
  report: BacktestReport,
  metrics: NonNullable<StrategyMiningCandidate["metrics"]>,
): StrategyIncubation {
  const splitIndex = Math.max(30, Math.floor(report.curve.length * 0.6))
  const inSample = segmentStats(report.curve.slice(0, splitIndex))
  const outSample = segmentStats(report.curve.slice(splitIndex))
  const decayPct = inSample.annualReturn === 0
    ? 0
    : ((inSample.annualReturn - outSample.annualReturn) / Math.max(Math.abs(inSample.annualReturn), 1)) * 100
  const regimes = buildRegimes(report.curve)
  const marketCoverage = regimes.filter((regime) => regime.days >= 20 && regime.excessReturn > 0).length
  const parameterGrid = buildParameterGrid(candidate, report, metrics, outSample, regimes)
  const parameterStability = parameterGrid.length
    ? parameterGrid.filter((item) => item.status === "pass").length / parameterGrid.length
    : 0
  const deflatedSharpeProxy = metrics.sharpe - Math.sqrt(Math.log(1 + candidate.strategy.factors.length * 4)) * 0.35
  const overfitRisk: StrategyIncubation["overfitRisk"] =
    deflatedSharpeProxy < 0.35 || Math.abs(decayPct) > 80 || parameterStability < 0.35
      ? "high"
      : deflatedSharpeProxy < 0.75 || Math.abs(decayPct) > 45 || parameterStability < 0.55
        ? "medium"
        : "low"
  const walkForwardPass = outSample.days >= 30 && outSample.annualReturn > 0 && outSample.excessReturn > -5 && decayPct < 65
  const blockers = [
    report.backtestSource === "Qveris" ? "" : "非价格类原始因子未补齐",
    walkForwardPass ? "" : "样本外衰减未通过",
    marketCoverage >= 2 ? "" : "市场环境覆盖不足",
    overfitRisk === "high" ? "过拟合风险高" : "",
    metrics.maxDrawdown <= 24 ? "" : "最大回撤过高",
    report.diagnosis.admission.status === "radar-ready" ? "" : report.diagnosis.admission.reason,
  ].filter(Boolean)
  const score = clampRound(
    report.diagnosis.admission.score * 0.42 +
      metrics.annualReturn * 0.12 +
      metrics.excessReturn * 0.08 +
      metrics.sharpe * 8 +
      parameterStability * 18 +
      marketCoverage * 6 -
      metrics.maxDrawdown * 0.32 -
      (overfitRisk === "high" ? 18 : overfitRisk === "medium" ? 8 : 0) -
      (walkForwardPass ? 0 : 10),
    0,
    100,
  )
  const radarEligible =
    candidate.status !== "rejected" &&
    score >= 76 &&
    overfitRisk === "low" &&
    walkForwardPass &&
    metrics.maxDrawdown <= 22
  const gate: StrategyIncubation["gate"] =
    radarEligible
      ? "雷达候选"
      : score >= 58 && metrics.annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN && outSample.annualReturn > 0
        ? "模拟观察"
        : score >= 36
          ? "修正复测"
          : "淘汰"

  return {
    score,
    gate,
    overfitRisk,
    marketCoverage,
    walkForward: {
      inSampleAnnualReturn: round2(inSample.annualReturn),
      outSampleAnnualReturn: round2(outSample.annualReturn),
      decayPct: round2(decayPct),
      pass: walkForwardPass,
    },
    regimes,
    parameterGrid,
    blockers: Array.from(new Set(blockers)).slice(0, 5),
    nextActions: buildIncubationActions(candidate, report, metrics, gate, overfitRisk, walkForwardPass, marketCoverage),
  }
}

function emptyIncubation(reason: string): StrategyIncubation {
  return {
    score: 0,
    gate: "淘汰",
    overfitRisk: "high",
    marketCoverage: 0,
    walkForward: { inSampleAnnualReturn: 0, outSampleAnnualReturn: 0, decayPct: 0, pass: false },
    regimes: [],
    parameterGrid: [{ name: "基础回测", score: 0, status: "fail", note: reason }],
    blockers: [reason],
    nextActions: ["先补齐可回测数据，再重新进入策略矿工。"],
  }
}

function segmentStats(points: BacktestReport["curve"]) {
  if (!points.length) return { days: 0, totalReturn: 0, annualReturn: 0, excessReturn: 0, hitRate: 0, maxDrawdown: 0, sharpe: 0 }
  let equity = 1
  let benchmark = 1
  let peak = 1
  const returns = points.map((point) => point.dailyReturn)
  for (const point of points) {
    equity *= 1 + point.dailyReturn
    benchmark *= 1 + point.benchmarkReturn
    peak = Math.max(peak, equity)
  }
  const totalReturn = equity - 1
  const benchmarkReturn = benchmark - 1
  const vol = std(returns) * Math.sqrt(252)
  return {
    days: points.length,
    totalReturn: round2(totalReturn * 100),
    annualReturn: round2((Math.pow(Math.max(equity, 0.0001), 252 / Math.max(points.length, 1)) - 1) * 100),
    excessReturn: round2((totalReturn - benchmarkReturn) * 100),
    hitRate: round2((returns.filter((value) => value > 0).length / points.length) * 100),
    maxDrawdown: round2(Math.min(...points.map((point) => point.drawdown), 0) * 100),
    sharpe: vol === 0 ? 0 : round2((mean(returns) * 252) / vol),
  }
}

function buildRegimes(points: BacktestReport["curve"]): StrategyIncubation["regimes"] {
  const groups = [
    { name: "强势" as const, points: points.filter((point) => point.benchmarkReturn > 0.003) },
    { name: "震荡" as const, points: points.filter((point) => Math.abs(point.benchmarkReturn) <= 0.003) },
    { name: "弱势" as const, points: points.filter((point) => point.benchmarkReturn < -0.003) },
  ]
  return groups.map((group) => {
    const stats = segmentStats(group.points)
    const benchmarkReturn = group.points.reduce((sum, point) => sum + point.benchmarkReturn, 0) * 100
    const strategyReturn = group.points.reduce((sum, point) => sum + point.dailyReturn, 0) * 100
    return {
      name: group.name,
      days: group.points.length,
      strategyReturn: round2(strategyReturn),
      benchmarkReturn: round2(benchmarkReturn),
      excessReturn: round2(stats.excessReturn),
      hitRate: stats.hitRate,
    }
  })
}

function buildParameterGrid(
  candidate: StrategyMiningCandidate,
  report: BacktestReport,
  metrics: NonNullable<StrategyMiningCandidate["metrics"]>,
  outSample: ReturnType<typeof segmentStats>,
  regimes: StrategyIncubation["regimes"],
): StrategyIncubation["parameterGrid"] {
  const avgTurnover = mean(report.curve.map((point) => point.turnover))
  const weak = regimes.find((item) => item.name === "弱势")
  const grid: StrategyIncubation["parameterGrid"] = [
    {
      name: "基础组合",
      score: clampRound(report.diagnosis.admission.score, 0, 100),
      status: report.diagnosis.admission.score >= 72 ? "pass" : report.diagnosis.admission.score >= 45 ? "watch" : "fail",
      note: report.diagnosis.admission.reason,
    },
    {
      name: "样本外 40%",
      score: clampRound(outSample.annualReturn + outSample.excessReturn + 50, 0, 100),
      status: outSample.annualReturn > 0 && outSample.excessReturn > -5 ? "pass" : outSample.annualReturn > -10 ? "watch" : "fail",
      note: `样本外年化 ${outSample.annualReturn.toFixed(2)}%，超额 ${outSample.excessReturn.toFixed(2)}%。`,
    },
    {
      name: "弱市过滤",
      score: clampRound((weak?.excessReturn ?? -20) + 60, 0, 100),
      status: (weak?.days ?? 0) >= 20 && (weak?.excessReturn ?? -Infinity) > 0 ? "pass" : (weak?.excessReturn ?? -Infinity) > -8 ? "watch" : "fail",
      note: weak ? `弱市 ${weak.days} 天，超额 ${weak.excessReturn.toFixed(2)}%。` : "弱市样本不足。",
    },
    {
      name: "降换手压力",
      score: clampRound(90 - avgTurnover * 120 - Math.max(0, metrics.maxDrawdown - 18), 0, 100),
      status: avgTurnover <= 0.25 && metrics.maxDrawdown <= 22 ? "pass" : avgTurnover <= 0.38 ? "watch" : "fail",
      note: `平均换手 ${(avgTurnover * 100).toFixed(1)}%，最大回撤 ${metrics.maxDrawdown.toFixed(2)}%。`,
    },
  ]
  if (candidate.strategy.factors.some((factor) => !isDirectPriceFactor(factor))) {
    grid.push({
      name: "原始因子补齐",
      score: 35,
      status: "fail",
      note: "包含资金/新闻/AI/估值代理因子，需补齐 Qveris 原始字段后复测。",
    })
  }
  return grid
}

function buildIncubationActions(
  candidate: StrategyMiningCandidate,
  report: BacktestReport,
  metrics: NonNullable<StrategyMiningCandidate["metrics"]>,
  gate: StrategyIncubation["gate"],
  overfitRisk: StrategyIncubation["overfitRisk"],
  walkForwardPass: boolean,
  marketCoverage: number,
) {
  const actions: string[] = []
  if (gate === "模拟观察") actions.push("进入 L5 模拟盘观察 20 个交易日，记录信号后真实浮盈和回撤。")
  if (!walkForwardPass) actions.push("做 walk-forward 参数复测，优先降低样本外收益衰减。")
  if (marketCoverage < 2) actions.push("加入市场环境开关：强势、震荡、弱势分别设置仓位。")
  if (overfitRisk !== "low") actions.push("减少因子数量或提高入场阈值，避免多因子叠加造成假阳性。")
  if (metrics.maxDrawdown > 24) actions.push("加入组合级回撤止损和弱市空仓，把最大回撤压到 18%-22% 以下。")
  if (report.backtestSource !== "Qveris") actions.push("补齐资金流/新闻/AI/估值原始字段后再给出最终准入结论。")
  if (candidate.strategy.freq === "intraday") actions.push("补齐 1m/5m 历史 K 线和 VWAP 字段，否则日内策略只保留实验状态。")
  if (!actions.length) actions.push("保持观察，下一轮用更大股票池和最近 3 个月模拟盘继续验证。")
  return Array.from(new Set(actions)).slice(0, 5)
}

function mean(values: number[]) {
  const clean = values.filter(Number.isFinite)
  if (!clean.length) return 0
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function std(values: number[]) {
  const avg = mean(values)
  const clean = values.filter(Number.isFinite)
  if (!clean.length) return 0
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / clean.length)
}

function clampRound(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.round(Math.max(min, Math.min(max, value)))
}

function round2(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

function isDirectPriceFactor(factorId: string) {
  return [
    "f-mom-60d",
    "f-vol-spike",
    "f-rev-5d",
    "f-donchian-55",
    "f-atr-compression",
    "f-minervini-trend",
    "f-absolute-momentum",
    "f-low-vol-mom",
    "f-rsi2-reversal",
    "f-bollinger-revert",
    "f-sma200-momentum",
    "f-risk-adjusted-mom",
    "f-macd-trend",
    "f-tight-breakout",
    "f-pullback-uptrend",
    "f-intra-vwap",
    "f-overnight",
  ].includes(factorId)
}

function shortHash(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  return Math.abs(hash).toString(36).slice(0, 6)
}
