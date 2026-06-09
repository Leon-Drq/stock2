import Link from "next/link"
import { Database, FileUp, FlaskConical } from "lucide-react"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { StrategyPipelineStrip } from "@/components/strategies/strategy-pipeline-strip"
import { StrategyCandidateBoard } from "@/components/strategy-candidates/strategy-candidate-board"
import { StrategyLabClient } from "@/components/strategy-lab/strategy-lab-client"
import { StrategyMinerDashboard } from "@/components/strategy-miner/strategy-miner-dashboard"
import { getDefaultModelRuntime } from "@/lib/model-providers"
import { getStrategyMinerConfig } from "@/lib/strategy-miner-config"
import { compactStrategyMiningReport, runStrategyMining, type StrategyMiningReport } from "@/lib/strategy-miner"

export const metadata = {
  title: "策略研究 — Stock Radar",
}

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>
type StrategyResearchTab = "candidates" | "miner" | "lab"

const STRATEGY_MINER_TIMEOUT_MS = 6_000

const TABS: Array<{
  id: StrategyResearchTab
  label: string
  desc: string
  icon: typeof Database
}> = [
  {
    id: "candidates",
    label: "候选池",
    desc: "公开策略精选清单",
    icon: Database,
  },
  {
    id: "miner",
    label: "策略矿工",
    desc: "GitHub / 公开模板挖掘",
    icon: FlaskConical,
  },
  {
    id: "lab",
    label: "策略实验室",
    desc: "文档、截图、文字转策略",
    icon: FileUp,
  },
]

export default async function StrategyResearchPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {}
  const activeTab = normalizeTab(firstParam(params, "tab"))
  const minerReport = activeTab === "miner" ? await getStrategyMiningReport() : null
  const defaultModel = getDefaultModelRuntime()

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 2"
        layerEn="Strategy Research"
        title="策略研究"
        subtitle="把外部策略、AI 生成策略和用户文档统一放进研究流水线：先看候选和数据缺口，再用 Qveris 真实历史数据回测，最后进入策略目录、雷达和实盘模拟。"
      />
      <StrategyPipelineStrip
        current="research"
        summary="这里是策略入口，不承诺收益，只负责把想法变成可回测、可解释、可追踪的候选。"
      />
      <StrategyResearchTabs activeTab={activeTab} />
      {activeTab === "candidates" && <StrategyCandidateBoard />}
      {activeTab === "miner" && minerReport && <StrategyMinerDashboard report={minerReport} />}
      {activeTab === "lab" && (
        <div className="mt-5">
          <StrategyLabClient defaultModel={defaultModel} />
        </div>
      )}
    </PageShell>
  )
}

function StrategyResearchTabs({ activeTab }: { activeTab: StrategyResearchTab }) {
  return (
    <nav className="mt-5 grid gap-2 rounded-[7px] border border-rule bg-white p-2 md:grid-cols-3" aria-label="策略研究分区">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const active = activeTab === tab.id
        return (
          <Link
            key={tab.id}
            href={`/strategy-research?tab=${tab.id}`}
            className={`rounded-[7px] border px-3 py-3 transition-colors ${
              active ? "border-ink bg-ink text-paper" : "border-rule bg-[#fafafa] text-ink hover:bg-white"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4" aria-hidden />
              <span className="text-[14px] font-semibold">{tab.label}</span>
            </div>
            <p className={`mt-2 text-[12px] leading-5 ${active ? "text-paper/70" : "text-ink-muted"}`}>
              {tab.desc}
            </p>
          </Link>
        )
      })}
    </nav>
  )
}

async function getStrategyMiningReport(): Promise<StrategyMiningReport> {
  try {
    const config = await getStrategyMinerConfig()
    return await withTimeout(
      runStrategyMining({
        persist: true,
        config,
        maxCandidates: Math.min(config.maxCandidates, 10),
        githubLimitPerQuery: Math.min(config.githubLimitPerQuery, 2),
        immediateBacktestLimit: Math.min(config.immediateBacktestLimit, 8),
      }).then(compactStrategyMiningReport),
      STRATEGY_MINER_TIMEOUT_MS,
    )
  } catch (error) {
    return fallbackStrategyMiningReport(error)
  }
}

function fallbackStrategyMiningReport(error: unknown): StrategyMiningReport {
  const reason = error instanceof Error ? error.message : String(error)
  return {
    generatedAt: new Date().toISOString(),
    candidates: [],
    summary: {
      sources: 0,
      candidates: 0,
      backtested: 0,
      promoted: 0,
      watchlist: 0,
      rejected: 0,
      github: 0,
      curated: 0,
    },
    notes: [
      "策略矿工后台挖掘和批量回测耗时较长，本次首屏已切换为轻量状态，避免页面一直卡在加载。",
      `降级原因：${reason}`,
      "后台 cron/refresh 会按策略矿工配置继续执行；可稍后刷新，或先到策略目录/真实回测查看已经入库的策略。",
    ],
    store: { driver: "memory", persisted: false },
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`超过 ${Math.round(timeoutMs / 1000)} 秒未完成`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function firstParam(params: SearchParams | undefined, key: string) {
  const value = params?.[key]
  return Array.isArray(value) ? value[0] : value
}

function normalizeTab(value: string | undefined): StrategyResearchTab {
  if (value === "miner" || value === "lab" || value === "candidates") return value
  return "candidates"
}
