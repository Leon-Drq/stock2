"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  getStrategyCatalogGateReason,
  isStrategyCatalogApproved,
  STRATEGY_CATALOG_MAX_DRAWDOWN,
  STRATEGY_CATALOG_MIN_ANNUAL_RETURN,
  STRATEGY_CATALOG_MIN_SCORE,
  type Strategy,
} from "@/lib/catalog"
import { FrequencyFilter, type FrequencyId } from "@/components/shared/frequency-filter"
import { loadCustomStrategies, storedStrategyToCatalogStrategy } from "@/lib/custom-strategies"
import { formatBeijingDateTime } from "@/lib/format"
import { buildStrategyDeploymentSnapshot, type StrategyDeploymentDecision, type StrategyDeploymentSnapshot } from "@/lib/strategy-deployment"
import type { StrategyRegistryEntry, StrategyRegistrySnapshot } from "@/lib/strategy-registry-store"

export function StrategiesClient({
  strategies,
  notes = [],
  generatedAt,
  registrySnapshot,
}: {
  strategies: Strategy[]
  notes?: string[]
  generatedAt?: string
  registrySnapshot?: StrategyRegistrySnapshot
}) {
  const [freq, setFreq] = useState<FrequencyId>("all")
  const [customStrategies, setCustomStrategies] = useState<Strategy[]>([])

  useEffect(() => {
    function refresh() {
      setCustomStrategies(loadCustomStrategies().map(storedStrategyToCatalogStrategy))
    }
    refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === "stock-radar.custom-strategies.v1") refresh()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const allStrategies = useMemo(() => {
    const byId = new Map<string, Strategy>()
    for (const strategy of strategies) byId.set(strategy.id, strategy)
    for (const strategy of customStrategies) byId.set(strategy.id, strategy)
    return Array.from(byId.values()).sort((a, b) => (b.rankScore ?? b.admission?.score ?? -1) - (a.rankScore ?? a.admission?.score ?? -1))
  }, [strategies, customStrategies])
  const activeStrategies = useMemo(() => {
    return allStrategies.filter(isStrategyCatalogApproved)
  }, [allStrategies])
  const rejectedStrategies = useMemo(() => allStrategies.filter((strategy) => !isStrategyCatalogApproved(strategy)), [allStrategies])

  const radarReady = activeStrategies.filter((strategy) => strategy.admission?.status === "radar-ready")
  const watchlist = activeStrategies.filter((strategy) => strategy.admission?.status === "watchlist")
  const blocked = rejectedStrategies

  const filtered = useMemo(() => {
    if (freq === "all") return activeStrategies
    return activeStrategies.filter((s) => s.freq === freq)
  }, [activeStrategies, freq])
  const hiddenFilteredCount = useMemo(() => {
    if (freq === "all") return rejectedStrategies.length
    return rejectedStrategies.filter((s) => s.freq === freq).length
  }, [rejectedStrategies, freq])
  const sourceSummary = useMemo(() => {
    return allStrategies.reduce(
      (summary, strategy) => {
        const source = strategy.registrySource ?? "catalog"
        summary[source] += 1
        return summary
      },
      { catalog: 0, miner: 0, lab: 0 },
    )
  }, [allStrategies])
  const leaderboardStrategies = activeStrategies.slice(0, 8)
  const hasOnlyRejected = activeStrategies.length === 0 && rejectedStrategies.length > 0
  const rejectionSummary = useMemo(() => buildRejectionSummary(rejectedStrategies), [rejectedStrategies])
  const deploymentSnapshot = useMemo(
    () => registrySnapshot ? buildStrategyDeploymentSnapshot(registrySnapshot) : null,
    [registrySnapshot],
  )
  const miningQueue = useMemo(() => {
    return registrySnapshot?.entries
      .filter((entry) => entry.source === "miner" && (entry.status === "queued" || entry.status === "running"))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 10) ?? []
  }, [registrySnapshot])
  const admissionActions = useMemo(() => {
    return buildAdmissionActions({
      allStrategies,
      activeStrategies,
      rejectedStrategies,
      radarReady,
      watchlist,
      registrySnapshot,
    })
  }, [activeStrategies, allStrategies, radarReady, registrySnapshot, rejectedStrategies, watchlist])

  return (
    <>
      <div className="mt-5">
        <FrequencyFilter value={freq} onChange={setFreq} />
      </div>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">catalog gate</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">
              {activeStrategies.length}/{allStrategies.length} 个策略进入正式目录
            </h2>
            <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
              门槛：真实回测、Qveris 原始数据、年化 ≥ {STRATEGY_CATALOG_MIN_ANNUAL_RETURN}%、最大回撤 ≤ {STRATEGY_CATALOG_MAX_DRAWDOWN}%、准入分 ≥ {STRATEGY_CATALOG_MIN_SCORE}。
            </p>
          </div>
          {generatedAt && (
            <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
              {formatBeijingDateTime(generatedAt, { seconds: true })}
            </span>
          )}
        </div>
        {notes.length > 0 && (
          <div className="mb-4 grid gap-2">
            {notes.map((note) => (
              <p key={note} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
                {note}
              </p>
            ))}
          </div>
        )}
        <div className="mb-4 grid grid-cols-3 gap-2 md:max-w-[520px]">
          <MiniGate label="内置目录" value={sourceSummary.catalog} tone="good" />
          <MiniGate label="策略矿工" value={sourceSummary.miner} tone="warning" />
          <MiniGate label="策略实验室" value={sourceSummary.lab} tone="warning" />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <ActionCard title="上游研究" desc="候选池 / 矿工 / 实验室" cta="研究" href="/strategy-research" />
          <ActionCard title="真实回测" desc="先验证，再入库" cta="运行" href="/backtest" />
          <ActionCard title="正式目录" desc="只展示通过项" cta="查看" href="/strategies" />
        </div>
      </section>

      {registrySnapshot && (
        <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-ink-muted">strategy registry</p>
              <h2 className="mt-2 text-[18px] font-semibold text-ink">统一策略注册表</h2>
              <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
                注册表统一保存内置、矿工和实验室策略的最近一次真实回测；正式策略目录只读取已经过门禁的策略，失败和待验证项留在回测页处理。
              </p>
            </div>
            <span className={`rounded-[7px] border border-rule px-3 py-2 font-mono text-[11px] ${
              registrySnapshot.status === "ready" ? "bg-[#e7f4eb] text-health-ok" : "bg-[#fafafa] text-warning"
            }`}>
              {registrySnapshot.driver} / {registrySnapshot.status}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
            <MiniGate label="注册策略" value={registrySnapshot.summary.total} tone="good" />
            <MiniGate label="雷达候选" value={registrySnapshot.summary.radarReady} tone="good" />
            <MiniGate label="观察池" value={registrySnapshot.summary.watchlist} tone="warning" />
            <MiniGate label="拦截" value={registrySnapshot.summary.blocked} tone="bad" />
            <MiniGate label="排队" value={registrySnapshot.summary.queuedJobs} tone="warning" />
            <MiniGate label="运行" value={registrySnapshot.summary.runningJobs} tone="good" />
          </div>
          <div className="mt-3 grid gap-2 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <p className="font-mono text-[11px] text-ink-muted">latest job</p>
              <p className="mt-2 text-[12px] leading-5 text-ink-muted">
                {registrySnapshot.jobs[0]
                  ? `${registrySnapshot.jobs[0].status} · ${registrySnapshot.jobs[0].summary ?? registrySnapshot.jobs[0].kind}`
                  : "还没有任务记录。"}
              </p>
            </div>
            <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <p className="font-mono text-[11px] text-ink-muted">top registry</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {registrySnapshot.entries.slice(0, 6).map((entry) => (
                  <span key={entry.strategyId} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                    {entry.name} · {Math.round(entry.score)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {registrySnapshot && (
        <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-ink-muted">miner queue</p>
              <h2 className="mt-2 text-[18px] font-semibold text-ink">矿工待回测队列</h2>
              <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
                策略矿工发现的候选会先写入统一注册表；未完成真实回测前只排队和诊断，不进入雷达推荐。
              </p>
            </div>
            <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
              {registrySnapshot.entries.filter((entry) => entry.source === "miner" && (entry.status === "queued" || entry.status === "running")).length} 个待处理
            </span>
          </div>
          <div className="mt-4 grid gap-2 xl:grid-cols-2">
            {miningQueue.map((entry) => (
              <MiningQueueCard key={entry.strategyId} entry={entry} />
            ))}
            {miningQueue.length === 0 && (
              <div className="rounded-[7px] border border-rule bg-[#fafafa] py-10 text-center text-sm text-ink-muted xl:col-span-2">
                当前没有矿工候选排队；新的 GitHub/公开策略挖掘结果会自动进入这里。
              </div>
            )}
          </div>
        </section>
      )}

      {deploymentSnapshot && (
        <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-ink-muted">auto deployment</p>
              <h2 className="mt-2 text-[18px] font-semibold text-ink">策略自动上线判定</h2>
              <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
                真实回测结果会统一转成发布动作：可执行策略进雷达并接入模拟盘；缺执行映射的策略先进模拟观察；未达标策略继续拦截。
              </p>
            </div>
            <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
              {deploymentSnapshot.summary.total} 个注册策略
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <MiniGate label="雷达上线" value={deploymentSnapshot.summary.radarOnline} tone="good" />
            <MiniGate label="模拟观察" value={deploymentSnapshot.summary.paperWatch} tone="warning" />
            <MiniGate label="缺执行映射" value={deploymentSnapshot.summary.mappingMissing} tone="warning" />
            <MiniGate label="拦截" value={deploymentSnapshot.summary.blocked} tone="bad" />
          </div>
          <div className="mt-4 grid gap-2 xl:grid-cols-2">
            {deploymentSnapshot.decisions.slice(0, 8).map((decision) => (
              <DeploymentDecisionCard key={decision.strategyId} decision={decision} />
            ))}
            {deploymentSnapshot.decisions.length === 0 && (
              <div className="rounded-[7px] border border-rule bg-[#fafafa] py-10 text-center text-sm text-ink-muted xl:col-span-2">
                注册表里还没有可发布策略；先跑真实回测，结果会自动进入这里。
              </div>
            )}
          </div>
        </section>
      )}

      {deploymentSnapshot && (
        <StrategyQualityMatrix snapshot={deploymentSnapshot} />
      )}

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">admission pipeline</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">策略上线动作队列</h2>
            <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
              这里把“策略多但雷达为空”的原因拆成四道门：真实回测、收益质量、雷达准入、任务队列。每道门只给可执行结论。
            </p>
          </div>
          <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            {admissionActions.filter((item) => item.status !== "done").length} 个待处理
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {admissionActions.map((action) => (
            <div key={action.title} className={`rounded-[7px] border px-3 py-3 ${action.status === "done" ? "border-health-ok/20 bg-health-ok/5" : action.status === "blocked" ? "border-bear/20 bg-bear/5" : "border-rule bg-[#fafafa]"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] text-ink-faint">{action.label}</p>
                  <h3 className="mt-1 text-[14px] font-semibold text-ink">{action.title}</h3>
                </div>
                <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[9px] ${admissionActionClass(action.status)}`}>
                  {action.status}
                </span>
              </div>
              <p className="mt-2 font-mono text-[15px] font-semibold text-ink">{action.value}</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">{action.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">strategy leaderboard</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">已通过策略排行榜</h2>
            <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
              这里不再展示待回测或未达标策略；它们只保留在真实回测页做诊断和复测。
            </p>
            {hasOnlyRejected && (
              <p className="mt-2 max-w-[760px] rounded-[7px] border border-[#ead7b6] bg-[#fff8eb] px-3 py-2 text-[12px] leading-5 text-warning">
                当前没有策略通过正式目录准入。先去真实回测页查看拦截原因，修复后再进入目录。
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-right">
            <MiniGate label="雷达候选" value={radarReady.length} tone="good" />
            <MiniGate label="观察池" value={watchlist.length} tone="warning" />
            <MiniGate label="拦截" value={blocked.length} tone="bad" />
          </div>
        </div>
        <div className="grid gap-2 xl:grid-cols-2">
          {leaderboardStrategies.map((strategy, index) => (
            <LeaderboardRow key={strategy.id} strategy={strategy} rank={index + 1} />
          ))}
          {leaderboardStrategies.length === 0 && (
            <div className="rounded-[7px] border border-rule bg-[#fafafa] py-10 text-center text-sm text-ink-muted xl:col-span-2">
              暂时没有可展示策略，等待数据预热或新增策略后会自动刷新。
            </div>
          )}
        </div>
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[18px] font-semibold text-ink">正式策略目录</h2>
          <span className="font-mono text-[11px] text-ink-muted">
            年化 ≥ {STRATEGY_CATALOG_MIN_ANNUAL_RETURN}% · 分数 ≥ {STRATEGY_CATALOG_MIN_SCORE} · {filtered.length} 个
            {hiddenFilteredCount > 0 ? ` · 隐藏 ${hiddenFilteredCount} 个未达标候选` : ""}
          </span>
        </div>
        <ul className="grid gap-2 2xl:grid-cols-2">
          {filtered.map((s) => (
            <li key={s.id} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <StrategyRow strategy={s} />
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="rounded-[7px] border border-rule bg-[#fafafa] py-12 text-center text-sm text-ink-muted 2xl:col-span-2">
              当前筛选下没有通过准入的正式策略；请先在真实回测页完成复测和评分。
            </li>
          )}
        </ul>
      </section>

      {rejectedStrategies.length > 0 && (
        <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-ink-muted">not in catalog</p>
              <h2 className="mt-2 text-[18px] font-semibold text-ink">未入目录概览</h2>
              <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
                未通过项不再铺在策略目录里，避免把候选误当成可用策略；详细原因请到真实回测页按策略查看。
              </p>
            </div>
            <Link
              href="/backtest"
              className="inline-flex h-9 items-center rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink transition hover:bg-[#f5f5f4]"
            >
              去真实回测
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {rejectionSummary.map((item) => (
              <MiniGate key={item.label} label={item.label} value={item.count} tone={item.tone} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">
          回测引擎规格
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-ink-soft lg:grid-cols-3 2xl:grid-cols-6">
          <Spec label="撮合模式" value="事件驱动" />
          <Spec label="滑点" value="VWAP / 固定 bps" />
          <Spec label="手续费" value="A 股标准" />
          <Spec label="T+1" value="已支持" />
          <Spec label="涨跌停" value="无法成交" />
          <Spec label="复权" value="后复权" />
        </div>
      </section>
    </>
  )
}

function StrategyRow({ strategy }: { strategy: Strategy }) {
  const admission = strategy.admission
  const canSimulate =
    strategy.backtestStatus === "真实回测" &&
    strategy.annualReturn >= STRATEGY_CATALOG_MIN_ANNUAL_RETURN &&
    admission?.status !== "blocked"
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[18px] font-semibold text-ink">{strategy.name}</h3>
          <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            {strategy.author}
          </span>
          <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            {strategySourceLabel(strategy.registrySource)}
          </span>
          <span
            className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${
              strategy.status === "公开"
                ? "text-bear"
                : strategy.status === "审核中"
                  ? "text-neutral"
                  : "text-ink-faint"
            }`}
          >
            {strategy.status}
          </span>
          <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            {freqLabel(strategy.freq)}
          </span>
          <span
            className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${
              strategy.backtestStatus === "真实回测" ? "text-health-ok" : "text-warning"
            }`}
          >
            {strategy.backtestStatus} · {strategy.backtestSource}
          </span>
          {admission && (
            <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${admissionTextClass(admission.status)}`}>
              {admission.gate} · {admission.score}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-6 text-ink-muted">
          {strategy.desc}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {strategy.factors.map((f) => (
            <span
              key={f}
              className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-soft"
            >
              {f}
            </span>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] text-ink-muted">
          {strategy.subscribers} 人订阅
          {strategy.backtestSource === "Qveris K线代理" && (
            <span className="ml-2 text-warning">非价格类因子使用 K 线代理信号回测。</span>
          )}
          {strategy.backtestStatus !== "真实回测" && (
            <span className="ml-2 text-warning">当前收益指标仅为目录示例。</span>
          )}
        </p>
        {admission && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {admission.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-5">
          <Stat label="年化" value={formatSignedPercent(strategy.annualReturn)} accent={strategy.annualReturn >= 0 ? "bull" : "bear"} />
          <Stat label="回撤" value={`-${strategy.maxDrawdown}%`} accent="bear" />
          <Stat label="Sharpe" value={strategy.sharpe.toFixed(2)} />
          <Stat label="胜率" value={`${strategy.winRate}%`} />
        </div>
        <div className="mt-4 flex flex-wrap justify-start gap-2 xl:justify-end">
          <Link
            href={`/backtest?strategy=${encodeURIComponent(strategy.id)}`}
            className="inline-flex h-8 items-center rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink transition hover:bg-[#f5f5f4]"
          >
            真实回测
          </Link>
          {canSimulate ? (
            <Link
              href={`/simulation?strategy=${encodeURIComponent(strategy.id)}`}
              className="inline-flex h-8 items-center rounded-[7px] bg-ink px-3 font-mono text-[11px] text-white transition hover:bg-ink-soft"
            >
              接入模拟盘
            </Link>
          ) : (
            <span className="inline-flex h-8 items-center rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-faint">
              未达模拟门槛
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function LeaderboardRow({ strategy, rank }: { strategy: Strategy; rank: number }) {
  const admission = strategy.admission
  return (
    <Link href={`/backtest?strategy=${encodeURIComponent(strategy.id)}`} className="block rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 transition-colors hover:bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-ink-faint">#{String(rank).padStart(2, "0")}</span>
            <h3 className="truncate text-[15px] font-semibold text-ink">{strategy.name}</h3>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {strategySourceLabel(strategy.registrySource)}
            </span>
            <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${admissionTextClass(admission?.status)}`}>
              {admission?.gate ?? "待回测"}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-muted">{admission?.reason ?? strategy.desc}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(admission?.tags ?? ["待复测"]).slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-muted">{tag}</span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[10px] text-ink-faint">rank</p>
          <p className="font-mono text-[20px] font-semibold text-ink">{(strategy.rankScore ?? admission?.score ?? 0).toFixed(1)}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-muted">{formatSignedPercent(strategy.annualReturn)}</p>
        </div>
      </div>
    </Link>
  )
}

function DeploymentDecisionCard({ decision }: { decision: StrategyDeploymentDecision }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-ink">{decision.name}</h3>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {decision.source}
            </span>
            <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${deploymentLaneClass(decision.lane)}`}>
              {deploymentLaneLabel(decision.lane)}
            </span>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {decision.primaryAction}
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-ink-muted">{decision.reason}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[10px] text-ink-faint">score</p>
          <p className="font-mono text-[20px] font-semibold text-ink">{decision.score.toFixed(1)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <DeploymentGate label="策略雷达" value={decision.radar.label} note={decision.radar.reason} tone={decision.radar.status} />
        <DeploymentGate label="实盘模拟" value={decision.paper.label} note={decision.paper.reason} tone={decision.paper.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {decision.gates.map((gate) => (
          <div key={gate.key} className={`rounded-[7px] border px-2 py-2 ${deploymentGateCheckClass(gate.status)}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[9px] text-ink-faint">{gate.label}</p>
              <span className="font-mono text-[9px]">{deploymentGateStatusLabel(gate.status)}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[12px] font-semibold text-ink">{gate.value}</p>
            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-ink-muted">{gate.note}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-ink-muted">
          年化 {formatSignedPercent(round1(decision.annualReturn))} · 回撤 {round1(decision.maxDrawdown)}%
        </span>
        <Link
          href={`/backtest?strategy=${encodeURIComponent(decision.strategyId)}`}
          className="inline-flex h-7 items-center rounded-[7px] border border-rule bg-white px-2.5 font-mono text-[10px] text-ink transition hover:bg-[#f5f5f4]"
        >
          查看回测
        </Link>
      </div>
    </div>
  )
}

function MiningQueueCard({ entry }: { entry: StrategyRegistryEntry }) {
  const source = entry.metadata?.sourceName ?? (entry.metadata?.sourceKind === "github" ? "GitHub 候选" : "公开策略模板")
  const hypothesis = entry.metadata?.hypothesis ?? "等待真实历史回测验证收益、回撤、换手和样本外稳定性。"
  const sourceUrl = entry.metadata?.sourceUrl

  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{entry.name}</h3>
            <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${miningQueueStatusClass(entry.status)}`}>
              {entry.status === "running" ? "回测中" : "排队中"}
            </span>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {source}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ink-muted">{hypothesis}</p>
          {entry.metadata?.sourceQuery && (
            <p className="mt-2 font-mono text-[10px] text-ink-faint">query · {entry.metadata.sourceQuery}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(entry.metadata?.factors ?? []).slice(0, 5).map((factor) => (
              <span key={factor} className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                {factor}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[10px] text-ink-faint">updated · 北京时间</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">{formatBeijingDateTime(entry.updatedAt)}</p>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex h-7 items-center rounded-[7px] border border-rule bg-white px-2.5 font-mono text-[10px] text-ink transition hover:bg-[#f5f5f4]"
            >
              来源 ↗
            </a>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/backtest?strategy=${encodeURIComponent(entry.strategyId)}`}
          className="inline-flex h-7 items-center rounded-[7px] border border-rule bg-white px-2.5 font-mono text-[10px] text-ink transition hover:bg-[#f5f5f4]"
        >
          查看回测槽位
        </Link>
        <span className="font-mono text-[10px] text-ink-muted">
          {entry.admissionGate ?? "待真实回测"} · score {Math.round(entry.score)}
        </span>
      </div>
    </div>
  )
}

function DeploymentGate({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone: StrategyDeploymentDecision["radar"]["status"] | StrategyDeploymentDecision["paper"]["status"]
}) {
  const cls =
    tone === "online"
      ? "text-bull"
      : tone === "mapping-missing" || tone === "watch" || tone === "pending"
        ? "text-warning"
        : "text-bear"
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[12px] font-semibold ${cls}`}>{value}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-muted">{note}</p>
    </div>
  )
}

function MiniGate({ label, value, tone }: { label: string; value: number; tone: "good" | "warning" | "bad" }) {
  const color = tone === "good" ? "text-bull" : tone === "warning" ? "text-warning" : "text-bear"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[18px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function buildRejectionSummary(strategies: Strategy[]) {
  const summary = [
    {
      label: "待真实回测",
      count: 0,
      tone: "warning" as const,
      match: (reason: string) => reason.includes("尚未完成"),
    },
    {
      label: "数据代理",
      count: 0,
      tone: "warning" as const,
      match: (reason: string) => reason.includes("K 线代理") || reason.includes("示例指标"),
    },
    {
      label: "收益不达标",
      count: 0,
      tone: "bad" as const,
      match: (reason: string) => reason.includes("年化收益"),
    },
    {
      label: "风险/分数不达标",
      count: 0,
      tone: "bad" as const,
      match: (reason: string) => reason.includes("回撤") || reason.includes("准入") || reason.includes("分"),
    },
  ]

  for (const strategy of strategies) {
    const reason = getStrategyCatalogGateReason(strategy) ?? "其他原因"
    const bucket = summary.find((item) => item.match(reason)) ?? summary[summary.length - 1]
    bucket.count += 1
  }

  return summary
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: "bull" | "bear"
}) {
  const color = accent === "bull" ? "text-bull" : accent === "bear" ? "text-bear" : "text-ink"
  return (
    <div className="text-right">
      <p className="font-mono text-[9px] text-ink-faint">
        {label}
      </p>
      <p className={`mt-1 font-mono text-[16px] tabular ${color}`}>{value}</p>
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <span className="font-mono text-[10px] text-ink-faint">
        {label}
      </span>
      <span className="ml-2 text-ink">{value}</span>
    </div>
  )
}

function ActionCard({
  title,
  desc,
  cta,
  href,
}: {
  title: string
  desc: string
  cta: string
  href?: string
}) {
  const body = (
    <>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-muted">{desc}</p>
      <p className="mt-3 font-mono text-[10px] text-ink-soft">
        {cta} →
      </p>
    </>
  )
  const cls =
    "block rounded-[7px] border border-rule bg-[#fafafa] p-4 transition-colors hover:bg-white"
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    )
  }
  return <div className={cls}>{body}</div>
}

function StrategyQualityMatrix({ snapshot }: { snapshot: StrategyDeploymentSnapshot }) {
  const gateRows = buildGateQualityRows(snapshot)
  const topDecisions = snapshot.decisions.slice(0, 10)
  const avgScore = snapshot.decisions.length
    ? snapshot.decisions.reduce((sum, decision) => sum + decision.score, 0) / snapshot.decisions.length
    : 0
  const executable = snapshot.decisions.filter((decision) => decision.hasExecutableMapping).length
  const readyRatio = snapshot.decisions.length ? Math.round((snapshot.summary.radarOnline / snapshot.decisions.length) * 100) : 0

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-[11px] text-ink-muted">quality gate matrix</p>
          <h2 className="mt-2 text-[18px] font-semibold text-ink">策略准入评分系统</h2>
          <p className="mt-1 max-w-[820px] text-[13px] leading-5 text-ink-muted">
            每个策略先过真实回测、数据血缘、收益、回撤、稳定性和执行映射六道门；只有全部主门通过，才允许进入雷达和独立模拟账户。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
          <MiniGate label="平均分" value={Math.round(avgScore)} tone={avgScore >= 65 ? "good" : avgScore >= 45 ? "warning" : "bad"} />
          <MiniGate label="可执行" value={executable} tone={executable > 0 ? "good" : "bad"} />
          <MiniGate label="上线率" value={readyRatio} tone={readyRatio > 0 ? "good" : "warning"} />
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
        {gateRows.map((row) => (
          <div key={row.key} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <p className="font-mono text-[10px] text-ink-faint">{row.label}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className={`font-mono text-[20px] font-semibold ${row.pass > row.fail ? "text-health-ok" : "text-warning"}`}>
                {row.pass}
              </p>
              <p className="font-mono text-[10px] text-ink-muted">
                watch {row.warn} / fail {row.fail}
              </p>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-ink-muted">{row.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
          <thead className="border-b border-rule font-mono text-[10px] text-ink-muted">
            <tr>
              <th className="py-2 font-medium">策略</th>
              <th className="py-2 font-medium">分数</th>
              <th className="py-2 font-medium">上线通道</th>
              <th className="py-2 font-medium">真实回测</th>
              <th className="py-2 font-medium">数据血缘</th>
              <th className="py-2 font-medium">收益</th>
              <th className="py-2 font-medium">风险</th>
              <th className="py-2 font-medium">执行</th>
              <th className="py-2 font-medium">动作</th>
            </tr>
          </thead>
          <tbody>
            {topDecisions.map((decision) => (
              <tr key={decision.strategyId} className="border-b border-rule-soft last:border-0">
                <td className="py-3">
                  <p className="font-medium text-ink">{decision.name}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">{decision.source}</p>
                </td>
                <td className="py-3 font-mono text-[13px] text-ink">{decision.score.toFixed(1)}</td>
                <td className={`py-3 font-mono text-[11px] ${deploymentLaneClass(decision.lane)}`}>{deploymentLaneLabel(decision.lane)}</td>
                {(["backtest", "data", "return", "risk", "execution"] as const).map((key) => (
                  <td key={key} className="py-3">
                    <QualityGatePill gate={decision.gates.find((gate) => gate.key === key)} />
                  </td>
                ))}
                <td className="py-3">
                  <Link
                    href={`/backtest?strategy=${encodeURIComponent(decision.strategyId)}`}
                    className="inline-flex h-7 items-center rounded-[7px] border border-rule bg-white px-2.5 font-mono text-[10px] text-ink transition hover:bg-[#f5f5f4]"
                  >
                    回测
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-2 md:hidden">
        {topDecisions.map((decision) => (
          <div key={decision.strategyId} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">{decision.name}</p>
                <p className={`mt-1 font-mono text-[11px] ${deploymentLaneClass(decision.lane)}`}>{deploymentLaneLabel(decision.lane)}</p>
              </div>
              <span className="shrink-0 font-mono text-[18px] font-semibold text-ink">{decision.score.toFixed(0)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {decision.gates.map((gate) => (
                <QualityGatePill key={gate.key} gate={gate} compact />
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-5 text-ink-muted">{decision.reason}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function freqLabel(f: Strategy["freq"]) {
  return f === "intraday" ? "日内" : f === "swing" ? "波段" : f === "position" ? "周期" : "高频"
}

function strategySourceLabel(source?: Strategy["registrySource"]) {
  if (source === "miner") return "矿工"
  if (source === "lab") return "实验室"
  return "内置"
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value}%`
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function admissionTextClass(status?: NonNullable<Strategy["admission"]>["status"]) {
  return status === "radar-ready"
    ? "text-bull"
    : status === "watchlist"
      ? "text-warning"
      : status === "blocked"
        ? "text-bear"
        : "text-ink-muted"
}

function deploymentLaneLabel(lane: StrategyDeploymentDecision["lane"]) {
  if (lane === "radar-online") return "雷达上线"
  if (lane === "paper-watch") return "模拟观察"
  if (lane === "mapping-missing") return "缺执行映射"
  if (lane === "pending") return "等待回测"
  return "拦截"
}

function deploymentLaneClass(lane: StrategyDeploymentDecision["lane"]) {
  if (lane === "radar-online") return "text-bull"
  if (lane === "blocked") return "text-bear"
  return "text-warning"
}

function deploymentGateCheckClass(status: StrategyDeploymentDecision["gates"][number]["status"]) {
  if (status === "pass") return "border-[#c8ead2] bg-[#f7fcf9] text-health-ok"
  if (status === "warn") return "border-[#ead7b6] bg-[#fff8eb] text-warning"
  return "border-[#f0cbc6] bg-[#fff7f6] text-bear"
}

function deploymentGateStatusLabel(status: StrategyDeploymentDecision["gates"][number]["status"]) {
  if (status === "pass") return "pass"
  if (status === "warn") return "watch"
  return "fail"
}

function QualityGatePill({
  gate,
  compact = false,
}: {
  gate?: StrategyDeploymentDecision["gates"][number]
  compact?: boolean
}) {
  if (!gate) {
    return (
      <span className="inline-flex h-7 items-center rounded-[7px] border border-rule bg-white px-2 font-mono text-[10px] text-ink-faint">
        missing
      </span>
    )
  }
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-[7px] border px-2 font-mono text-[10px] ${deploymentGateCheckClass(gate.status)} ${
        compact ? "w-full justify-between" : ""
      }`}
      title={gate.note}
    >
      <span className={compact ? "truncate" : ""}>{compact ? gate.label : gate.value}</span>
      {compact && <span className="ml-2 shrink-0">{deploymentGateStatusLabel(gate.status)}</span>}
    </span>
  )
}

function miningQueueStatusClass(status: StrategyRegistryEntry["status"]) {
  if (status === "running") return "text-warning"
  if (status === "queued") return "text-ink-muted"
  return "text-ink-faint"
}

function buildGateQualityRows(snapshot: StrategyDeploymentSnapshot) {
  const labels: Record<StrategyDeploymentDecision["gates"][number]["key"], string> = {
    backtest: "真实回测",
    data: "数据血缘",
    return: "收益门槛",
    risk: "回撤控制",
    stability: "稳定评分",
    execution: "执行映射",
  }
  const notes: Record<StrategyDeploymentDecision["gates"][number]["key"], string> = {
    backtest: "无真实回测的策略不参与排序。",
    data: "优先使用 Qveris 原始真实数据。",
    return: "低于年化门槛自动拦截。",
    risk: "回撤过大只能观察或下线。",
    stability: "综合胜率、夏普和超额收益。",
    execution: "没有扫描适配器不能发雷达信号。",
  }
  return (Object.keys(labels) as Array<StrategyDeploymentDecision["gates"][number]["key"]>).map((key) => {
    const gates = snapshot.decisions.map((decision) => decision.gates.find((gate) => gate.key === key)).filter(Boolean) as StrategyDeploymentDecision["gates"]
    return {
      key,
      label: labels[key],
      note: notes[key],
      pass: gates.filter((gate) => gate.status === "pass").length,
      warn: gates.filter((gate) => gate.status === "warn").length,
      fail: gates.filter((gate) => gate.status === "fail").length,
    }
  })
}

type AdmissionAction = {
  label: string
  title: string
  value: string
  note: string
  status: "done" | "active" | "blocked"
}

function buildAdmissionActions({
  allStrategies,
  activeStrategies,
  rejectedStrategies,
  radarReady,
  watchlist,
  registrySnapshot,
}: {
  allStrategies: Strategy[]
  activeStrategies: Strategy[]
  rejectedStrategies: Strategy[]
  radarReady: Strategy[]
  watchlist: Strategy[]
  registrySnapshot?: StrategyRegistrySnapshot
}): AdmissionAction[] {
  const realCount = allStrategies.filter((strategy) => strategy.backtestStatus === "真实回测").length
  const untestedCount = Math.max(0, allStrategies.length - realCount)
  const belowReturnCount = allStrategies.filter((strategy) => strategy.backtestStatus === "真实回测" && strategy.annualReturn < STRATEGY_CATALOG_MIN_ANNUAL_RETURN).length
  const blockedByAdmission = allStrategies.filter((strategy) => strategy.admission?.status === "blocked").length
  const queuedJobs = registrySnapshot?.summary.queuedJobs ?? 0
  const runningJobs = registrySnapshot?.summary.runningJobs ?? 0

  return [
    {
      label: "gate 1",
      title: "真实回测覆盖",
      value: `${realCount}/${allStrategies.length}`,
      note: untestedCount > 0
        ? `还有 ${untestedCount} 个策略只有目录/矿工信息，先跑真实 K 线回测再排序。`
        : "目录策略都有真实 K 线回测记录，可以进入质量门禁。",
      status: untestedCount > 0 ? "active" : "done",
    },
    {
      label: "gate 2",
      title: "收益质量门槛",
      value: `${activeStrategies.length} 通过`,
      note: activeStrategies.length > 0
        ? `通过策略进入正式目录；${rejectedStrategies.length} 个未达标候选只保留在回测诊断中。`
        : `年化低于 ${STRATEGY_CATALOG_MIN_ANNUAL_RETURN}% 或风控不过关的策略不会进雷达，当前拦截 ${belowReturnCount + blockedByAdmission} 个。`,
      status: activeStrategies.length > 0 ? "done" : "blocked",
    },
    {
      label: "gate 3",
      title: "雷达准入",
      value: `${radarReady.length} 候选 / ${watchlist.length} 观察`,
      note: radarReady.length > 0
        ? "雷达层只读取候选策略，避免把低质量信号推给用户。"
        : watchlist.length > 0
          ? "当前只有观察池策略，建议先接入模拟盘而不是直接上线雷达。"
          : "没有策略达到雷达准入，下一步应继续挖掘或补齐非价格因子后复测。",
      status: radarReady.length > 0 ? "done" : "active",
    },
    {
      label: "gate 4",
      title: "任务队列",
      value: `${runningJobs} running / ${queuedJobs} queued`,
      note: runningJobs > 0
        ? "回测任务正在跑，等待结果写回注册表。"
        : queuedJobs > 0
          ? "有排队任务，后台执行后策略分数会自动更新。"
          : "当前没有积压任务，新增策略会先进入队列再回测。",
      status: runningJobs > 0 || queuedJobs > 0 ? "active" : "done",
    },
  ]
}

function admissionActionClass(status: AdmissionAction["status"]) {
  if (status === "done") return "text-health-ok"
  if (status === "blocked") return "text-bear"
  return "text-warning"
}
