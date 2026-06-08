import { DATA_SOURCES } from "@/lib/catalog"
import { getBacktestDataStoreSnapshot, getMarketDataQualitySnapshot } from "@/lib/backtest-data-store"
import { getNonPriceCoverageSnapshot, type NonPriceCoverageRow, type NonPriceSourceId } from "@/lib/non-price-data-store"

export type CoverageStage = {
  label: string
  note: string
  target: number
  covered: number
  status: "done" | "active" | "planned"
}

export type HistoryDepthStage = {
  label: string
  minBars: number
  covered: number
  target: number
  status: "done" | "partial" | "missing"
}

export type NonPriceDataStatus = {
  id: string
  name: string
  category: string
  status: "ready" | "proxy" | "missing"
  requiredFor: string[]
  storage: string
  note: string
  rows?: number
  symbols?: number
  latestAsOf?: string
}

export type BacktestDataReadinessReport = {
  generatedAt: string
  driver: "postgres" | "redis" | "memory"
  coverage: {
    currentPool: number
    coveredSymbols: number
    barRows: number
    averageBarsPerCoveredSymbol: number
    earliestDate?: string
    latestDate?: string
    stages: CoverageStage[]
    depthStages: HistoryDepthStage[]
  }
  database: {
    status: "ready" | "partial" | "permission-error" | "missing" | "error"
    note: string
    error?: string
  }
  nonPrice: NonPriceDataStatus[]
  quality: Array<{
    label: string
    value: string
    status: "good" | "warning" | "bad"
    note: string
  }>
  snapshots: {
    status: "ready" | "partial" | "missing"
    latestSnapshotDate?: string
    generatedAt?: string
    snapshotRows: number
    note: string
  }
}

export async function buildBacktestDataReadinessReport(): Promise<BacktestDataReadinessReport> {
  const [store, quality, nonPriceCoverage] = await Promise.all([
    getBacktestDataStoreSnapshot(),
    getMarketDataQualitySnapshot(),
    getNonPriceCoverageSnapshot(),
  ])
  const coveredSymbols = Math.max(quality.coveredStockPoolSymbols, store.totalSymbols)
  const barRows = Math.max(quality.barRows, store.totalBars)
  const currentPool = quality.stockPoolSymbols || store.stockPoolSymbols || 0
  const factorProxyReady = (store.marketData?.factorRows ?? 0) > 0 || quality.fieldCoverage.factorPct > 0
  const averageBarsPerCoveredSymbol = coveredSymbols > 0 ? Math.round(barRows / coveredSymbols) : 0
  const database = databaseStatus(store.driver, store.status, quality.status, quality.error, barRows)

  return {
    generatedAt: quality.checkedAt,
    driver: store.driver,
    database,
    coverage: {
      currentPool,
      coveredSymbols,
      barRows,
      averageBarsPerCoveredSymbol,
      earliestDate: quality.earliestDate ?? store.marketData?.earliestDate,
      latestDate: quality.latestDate ?? store.marketData?.latestDate,
      stages: buildCoverageStages(currentPool, coveredSymbols),
      depthStages: buildHistoryDepthStages(currentPool, coveredSymbols, averageBarsPerCoveredSymbol),
    },
    nonPrice: buildNonPriceStatuses(factorProxyReady, nonPriceCoverage.rows),
    quality: [
      {
        label: "历史 K 线",
        value: `${coveredSymbols}/${currentPool || 0}`,
        status: database.status === "permission-error" || database.status === "error" ? "bad" : coveredSymbols >= currentPool && currentPool > 0 ? "good" : coveredSymbols >= 100 ? "warning" : "bad",
        note: database.status === "permission-error" ? "数据库连接存在，但当前角色没有 public schema / 行情表读取权限。" : "回测默认优先读取 Supabase/Postgres 中的日线缓存。",
      },
      {
        label: "技术指标",
        value: `${quality.fieldCoverage.indicatorPct.toFixed(1)}%`,
        status: quality.fieldCoverage.indicatorPct >= 95 ? "good" : quality.fieldCoverage.indicatorPct > 0 ? "warning" : "bad",
        note: "MA / ATR / RSI / 波动率等指标由入库 K 线同步生成。",
      },
      {
        label: "派生因子",
        value: `${quality.fieldCoverage.factorPct.toFixed(1)}%`,
        status: quality.fieldCoverage.factorPct >= 90 ? "good" : quality.fieldCoverage.factorPct > 0 ? "warning" : "bad",
        note: "当前先覆盖价格量能派生因子，非价格因子需要原始字段补齐。",
      },
      {
        label: "交易日历",
        value: `${quality.tradingCalendar?.rows ?? 0}`,
        status: quality.fieldCoverage.calendarPct >= 85 ? "good" : (quality.tradingCalendar?.rows ?? 0) > 0 ? "warning" : "bad",
        note: `由入库日线反推交易日，最新 ${quality.tradingCalendar?.latestDate ?? "N/A"}，避免把休市误判成数据缺口。`,
      },
      {
        label: "指数基准",
        value: `${quality.indexes?.symbols ?? 0}/4`,
        status: quality.fieldCoverage.indexPct >= 100 ? "good" : (quality.indexes?.rows ?? 0) > 0 ? "warning" : "bad",
        note: `上证、深成指、创业板、中证500 行情入库，最新 ${quality.indexes?.latestDate ?? "N/A"}。`,
      },
      {
        label: "涨跌停/停牌",
        value: `${Math.min(quality.fieldCoverage.limitBandPct, quality.fieldCoverage.suspensionFlagPct).toFixed(1)}%`,
        status: Math.min(quality.fieldCoverage.limitBandPct, quality.fieldCoverage.suspensionFlagPct) >= 95 ? "good" : quality.fieldCoverage.limitBandPct > 0 ? "warning" : "bad",
        note: `已为 ${quality.limitRules?.limitRows ?? 0} 根 K 线补涨跌停价，识别停牌 ${quality.limitRules?.suspensionRows ?? 0} 条。`,
      },
      {
        label: "异常价格",
        value: `${quality.anomalyRows}`,
        status: quality.anomalyRows === 0 ? "good" : quality.anomalyRows < 10 ? "warning" : "bad",
        note: "OHLC 结构、非正价格、极端涨跌幅会被标出，避免污染回测。",
      },
    ],
    snapshots: {
      status: quality.dailySnapshot?.snapshotRows ? "ready" : store.driver === "postgres" && barRows > 0 ? "partial" : "missing",
      latestSnapshotDate: quality.dailySnapshot?.latestSnapshotDate,
      generatedAt: quality.dailySnapshot?.generatedAt,
      snapshotRows: quality.dailySnapshot?.snapshotRows ?? 0,
      note: quality.dailySnapshot?.snapshotRows
        ? "每日质量快照已写入 data_quality_snapshots，可用于复现当日回测环境。"
        : store.driver === "postgres"
          ? "历史行情已入库，等待下一次质量审计写入每日快照。"
          : "未接入持久数据库，无法保存跨请求快照。",
    },
  }
}

function buildCoverageStages(currentPool: number, covered: number): CoverageStage[] {
  const stages = [
    { label: "股票池覆盖", target: currentPool || 130, note: "当前系统股票池中已有日线入库的股票数" },
    { label: "扩容到 300 只", target: 300, note: "股票数量目标，不是 K 线天数" },
    { label: "扩容到 500 只", target: 500, note: "股票数量目标，不是 K 线天数" },
    { label: "全 A 股票覆盖", target: 5200, note: "全市场股票数量目标" },
  ]

  return stages.map((stage) => ({
    ...stage,
    covered: Math.min(covered, stage.target),
    status: covered >= stage.target ? "done" as const : stage.target <= 300 ? "active" as const : "planned" as const,
  }))
}

function buildHistoryDepthStages(currentPool: number, coveredSymbols: number, averageBars: number): HistoryDepthStage[] {
  const target = currentPool || 130
  const estimatedCovered = (minBars: number) =>
    coveredSymbols > 0 && averageBars >= minBars ? coveredSymbols : 0
  const stages = [
    { label: "短窗回测", minBars: 120, covered: estimatedCovered(120) },
    { label: "半年级回测", minBars: 300, covered: estimatedCovered(300) },
    { label: "长窗回测", minBars: 500, covered: estimatedCovered(500) },
  ]
  return stages.map((stage) => ({
    ...stage,
    target,
    status: stage.covered >= target ? "done" as const : stage.covered > 0 ? "partial" as const : "missing" as const,
  }))
}

function databaseStatus(
  driver: BacktestDataReadinessReport["driver"],
  storeStatus: "ready" | "fallback" | "error",
  qualityStatus: "ready" | "fallback" | "error",
  error: string | undefined,
  barRows: number,
): BacktestDataReadinessReport["database"] {
  if (driver === "memory") {
    return {
      status: "missing",
      note: "未接入持久数据库，回测数据只能保存在实例内缓存。",
    }
  }
  if (storeStatus === "error" || qualityStatus === "error") {
    const permissionDenied = /permission denied|权限/i.test(error ?? "")
    return {
      status: permissionDenied ? "permission-error" : "error",
      note: permissionDenied
        ? "Supabase/Postgres 已连接，但运行时数据库角色缺少 public schema 或行情表权限。"
        : "数据库质量审计失败，需要检查连接串、表结构或 SQL 权限。",
      error,
    }
  }
  if (barRows > 0) {
    return {
      status: "ready",
      note: "数据库可读，历史行情可作为回测缓存。",
    }
  }
  return {
    status: "partial",
    note: "数据库可连接，但当前没有可用于回测的历史行情行。",
  }
}

function buildNonPriceStatuses(factorProxyReady: boolean, coverageRows: NonPriceCoverageRow[] = []): NonPriceDataStatus[] {
  const coverageBySource = new Map(coverageRows.map((row) => [row.sourceId, row]))
  const specs: Array<{
    sourceId: NonPriceSourceId
    requiredFor: string[]
    storage: string
    note: string
  }> = [
    {
      sourceId: "fund-flow",
      requiredFor: ["主力资金流", "AI 资金共振", "盘口锁仓战术"],
      storage: "stock_non_price_factors / factor_values",
      note: "需要分钟/日度大单、超大单、买一挂单和成交额分布。",
    },
    {
      sourceId: "north-bound",
      requiredFor: ["北向净流入分位", "资金趋势过滤"],
      storage: "stock_non_price_factors",
      note: "需要沪深港通持股、净买入和流通市值标准化字段。",
    },
    {
      sourceId: "dragon-tiger",
      requiredFor: ["龙虎榜机构净买", "游资席位识别"],
      storage: "stock_events / stock_non_price_factors",
      note: "需要上榜原因、席位买卖额和机构标记。",
    },
    {
      sourceId: "news",
      requiredFor: ["新闻情感动量", "事件驱动雷达"],
      storage: "stock_events / stock_sentiment",
      note: "需要新闻、研报和社交文本的实体识别与情绪分。",
    },
    {
      sourceId: "announcement",
      requiredFor: ["公告事件过滤", "业绩预告因子"],
      storage: "stock_events",
      note: "需要公告类型、发布时间、结构化摘要和影响方向。",
    },
    {
      sourceId: "fin-statement",
      requiredFor: ["估值/财务质量", "价值轮动"],
      storage: "stock_fundamentals",
      note: "需要财务报表、估值、ROE、现金流和同比环比字段。",
    },
  ]

  return specs.map((spec) => {
    const source = DATA_SOURCES.find((item) => item.id === spec.sourceId)
    const coverage = coverageBySource.get(spec.sourceId)
    const persistedRows = coverage
      ? coverage.rawRows + coverage.factorRows + coverage.eventRows + coverage.sentimentRows + coverage.fundamentalRows
      : 0
    const status = persistedRows > 0
      ? "ready" as const
      : coverage?.sampledBindings
        ? "ready" as const
        : factorProxyReady
          ? "proxy" as const
          : "missing" as const
    const coverageNote = persistedRows > 0
      ? `已入库 ${persistedRows} 行，覆盖 ${coverage?.rawSymbols ?? 0} 只股票${coverage?.latestAsOf ? `，最新 ${coverage.latestAsOf}` : ""}。`
      : coverage?.bindings
        ? `已绑定 ${coverage.bindings} 个 Qveris 工具，等待采样入库。`
        : ""
    return {
      id: spec.sourceId,
      name: source?.name ?? spec.sourceId,
      category: source?.category ?? "非价格",
      status,
      requiredFor: spec.requiredFor,
      storage: `${spec.storage}${coverage ? ` · raw ${coverage.rawRows} / factor ${coverage.factorRows} / event ${coverage.eventRows}` : ""}`,
      note: coverageNote
        ? `${coverageNote} ${spec.note}`
        : factorProxyReady
          ? `${spec.note} 当前仅有 K 线代理因子，不能替代原始字段。`
          : spec.note,
      rows: persistedRows,
      symbols: coverage?.rawSymbols,
      latestAsOf: coverage?.latestAsOf,
    }
  })
}
