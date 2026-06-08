"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, ArrowUpRight, BadgeCheck, ChevronDown, CircleDollarSign, ClipboardList, Clock3, Database, GitMerge, ListChecks, Radio, RefreshCw, ShoppingCart, WalletCards, Zap } from "lucide-react"
import { CHINA_TIME_LABEL, formatBeijingDateTime, formatChinaDate } from "@/lib/format"
import { PAPER_CONFLUENCE_STRATEGY_ID } from "@/lib/paper-confluence-constants"
import type { PaperAccount, PaperBacktestProfile, PaperEquityPoint, PaperOrder, PaperRange, PaperTradeChart } from "@/lib/paper-trading"
import type { PaperConfluenceSignal } from "@/lib/paper-confluence"
import type { RadarConfluenceSignal } from "@/lib/radar-confluence"
import { TradingViewKLineChart } from "@/components/simulation/tradingview-kline-chart"

const PAPER_AUTO_REFRESH_COOLDOWN_MS = 2 * 60 * 1000

export function PaperTradingDashboard({
  account,
  paperConfluence = [],
  radarConfluence = [],
}: {
  account: PaperAccount
  paperConfluence?: PaperConfluenceSignal[]
  radarConfluence?: RadarConfluenceSignal[]
}) {
  usePaperStartKeeper(account.strategyId, account.startedAt)
  const [selectedChartSymbol, setSelectedChartSymbol] = useState(account.tradeCharts[0]?.symbol ?? "")
  const selectedChart = useMemo(
    () => account.tradeCharts.find((chart) => chart.symbol === selectedChartSymbol) ?? account.tradeCharts[0],
    [account.tradeCharts, selectedChartSymbol],
  )
  const positionEntryOrders = useMemo(() => buildPositionEntryOrders(account.orders), [account.orders])
  const positionEntryTimes = useMemo(() => buildPositionEntryTimes(account.orders), [account.orders])
  const dailyReview = useMemo(() => buildDailyReview(account, positionEntryTimes), [account, positionEntryTimes])
  const executionAudit = useMemo(() => buildExecutionAudit(account), [account])
  const winSnapshot = useMemo(() => buildPaperWinSnapshot(account), [account])
  const visibleAccountOptions = useMemo(() => prioritizePaperOptions(account.options, account.strategyId), [account.options, account.strategyId])
  const activeBacktestProfile = useMemo(
    () => account.options.find((option) => option.id === account.strategyId)?.backtestProfile ?? account.backtestProfile,
    [account.backtestProfile, account.options, account.strategyId],
  )
  const autoRefresh = usePaperAutoRefresh(account)

  return (
    <div className="mt-5 min-w-0 space-y-5">
      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-[8px] bg-[#1e5a91] text-white sm:size-14">
              <Zap className="size-7" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="break-words text-[22px] font-semibold leading-tight text-ink sm:text-[26px]">{account.strategyName}</h2>
                <span className="rounded-full bg-[#e6f1ff] px-2 py-1 font-mono text-[10px] text-[#1e5a91]">
                  {account.admissionStatus} · {account.admissionScore}
                </span>
                <span className={`rounded-full px-2 py-1 font-mono text-[10px] ${ledgerPillClass(account)}`}>
                  {ledgerPillLabel(account)}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] ${runtimePillClass(account.runtime.tone)}`}>
                  <span className={`size-1.5 rounded-full ${runtimeDotClass(account.runtime.tone)}`} aria-hidden />
                  {account.runtime.label}
                </span>
                {autoRefresh.visible && (
                  <span className={`rounded-full px-2 py-1 font-mono text-[10px] ${autoRefreshPillClass(autoRefresh.tone)}`}>
                    {autoRefresh.label}
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-ink-muted">
                paper trading · 接入 {formatDateTime(account.startedAt)} · 统计 {account.rangeStart || "N/A"} 至 {account.rangeEnd || "N/A"} · 统计口径 {CHINA_TIME_LABEL}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["1m", "3m", "all"] as const).map((range) => (
              <RangeLink key={range} account={account} range={range} />
            ))}
            {account.strategyId && (
              <>
                <Link
                  href={simulationResetHref(account.strategyId, account.range)}
                  className="inline-flex h-9 items-center rounded-full border border-rule bg-white px-3 text-[12px] font-medium text-ink-muted transition hover:bg-[#fafafa] hover:text-ink"
                >
                  重新接入
                </Link>
                <Link
                  href={`/backtest?strategy=${encodeURIComponent(account.strategyId)}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#b9d7ff] bg-white px-3 text-[12px] font-medium text-[#1e5a91] transition hover:bg-[#f4f9ff]"
                >
                  回测明细
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {account.options.length > 0 && (
        <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <ListChecks className="size-4" aria-hidden />
                Strategy Accounts
              </div>
              <h3 className="mt-1 text-[17px] font-semibold text-ink">已上线模拟账户</h3>
            </div>
            <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
              {visibleAccountOptions.length} / {account.options.length} 个策略 · 每个策略独立账户
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {visibleAccountOptions.map((option) => {
              const active = option.id === account.strategyId
              const hasActivity = (option.positionCount ?? 0) > 0 || (option.orderCount ?? 0) > 0
              const firstRun = !option.startedAt && option.id === PAPER_CONFLUENCE_STRATEGY_ID
              const profile = option.backtestProfile
              return (
                <Link
                  key={option.id}
                  href={simulationHref(option.id, account.range, firstRun ? "now" : option.startedAt ?? account.startedAt)}
                  className={`block rounded-[7px] border px-3 py-3 transition ${
                    active
                      ? "border-[#1e5a91] bg-[#f4f9ff]"
                      : hasActivity
                        ? "border-[#c8ead2] bg-[#fbfefc] hover:bg-white"
                        : "border-rule bg-[#fafafa] hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{option.name}</p>
                    <span className={`shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${
                      active ? "bg-[#e6f1ff] text-[#1e5a91]" : "bg-white text-ink-muted"
                    }`}>
                      {active ? "当前" : option.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[10px] text-ink-muted">
                    <span className="truncate rounded-[5px] border border-rule-soft bg-white px-2 py-1">
                      准入分 {formatBacktestScore(profile.score)}
                    </span>
                    <span className={`truncate rounded-[5px] border border-rule-soft bg-white px-2 py-1 ${
                      profile.annualReturnPct >= 10 ? "text-health-ok" : profile.annualReturnPct < 0 ? "text-bear" : ""
                    }`}>
                      年化 {formatSignedPercent(profile.annualReturnPct)}
                    </span>
                    <span className={`truncate rounded-[5px] border border-rule-soft bg-white px-2 py-1 ${
                      profile.maxDrawdownPct > 25 ? "text-bear" : "text-ink-muted"
                    }`}>
                      回撤 {formatDrawdown(profile.maxDrawdownPct)}
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 font-mono text-[10px] text-ink-muted">
                    <span className="truncate rounded-[5px] border border-rule-soft bg-white px-2 py-1">
                      持仓 {option.positionCount ?? 0}
                    </span>
                    <span className="truncate rounded-[5px] border border-rule-soft bg-white px-2 py-1">
                      订单 {option.orderCount ?? 0}
                    </span>
                    <span className="truncate rounded-[5px] border border-rule-soft bg-white px-2 py-1">
                      平仓 {option.closedTradeCount ?? 0}
                    </span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[10px] text-ink-faint">
                    {profile.status} · {firstRun ? "待首次接入" : `接入 ${formatDateTime(option.startedAt ?? account.startedAt)}`}
                  </p>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <BacktestProfileStrip profile={activeBacktestProfile} />

      <RadarConfluencePanel signals={radarConfluence} />

      <PaperConfluencePanel signals={paperConfluence} rangeLabel="最近 5 日" />

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <Radio className="size-4" aria-hidden />
                运行监控
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`inline-flex h-8 items-center gap-2 rounded-[7px] px-3 font-mono text-[12px] ${runtimePillClass(account.runtime.tone)}`}>
                  <span className={`size-2 rounded-full ${runtimeDotClass(account.runtime.tone)}`} aria-hidden />
                  {account.runtime.label}
                </span>
                <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
                  {account.runtime.cadence}
                </span>
              </div>
              <p className="mt-3 max-w-[760px] text-[13px] leading-5 text-ink-muted">{account.runtime.detail}</p>
              <p className="mt-2 text-[13px] leading-5 text-ink">{account.runtime.lastAction}</p>
              {autoRefresh.visible && (
                <p className={`mt-2 text-[12px] leading-5 ${autoRefresh.tone === "bad" ? "text-bear" : autoRefresh.tone === "good" ? "text-health-ok" : "text-ink-muted"}`}>
                  {autoRefresh.detail}
                </p>
              )}
            </div>
            <div className="grid min-w-[260px] gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <RuntimeStamp icon={RefreshCw} label="最近心跳" value={formatDateTime(account.runtime.heartbeatAt)} />
              <RuntimeStamp icon={Database} label="行情截至" value={account.runtime.dataAsOf} />
              <RuntimeStamp icon={Clock3} label="下一次检查" value={`${CHINA_TIME_LABEL} ${account.runtime.nextCheckAt}`} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {account.runtime.checks.map((check) => (
            <div key={check.label} className="rounded-[7px] border border-rule bg-white px-3 py-3">
              <p className="font-mono text-[10px] text-ink-faint">{check.label}</p>
              <p className={`mt-1 font-mono text-[15px] font-semibold ${checkToneClass(check.tone)}`}>{check.value}</p>
              <p className="mt-1 text-[11px] leading-4 text-ink-muted">{check.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={WalletCards} label="总资产" value={formatMoney(account.currentEquity)} />
        <MetricCard
          icon={Activity}
          label="接入后收益率"
          value={formatSignedPercent(account.rangeReturnPct)}
          tone={account.rangeReturnPct >= 0 ? "good" : "bad"}
        />
        <MetricCard icon={CircleDollarSign} label="可用资金" value={formatMoney(account.availableCash)} />
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-[#1e5a91]">
              <Activity className="size-4" aria-hidden />
              接入后资产走势
            </div>
            <p className="mt-2 text-[13px] leading-5 text-ink-muted">
              起始资产：{formatMoney(account.startEquity)}　
              最新资产：{formatMoney(account.currentEquity)}　
              区间收益：<span className={account.rangeReturnPct >= 0 ? "text-bull" : "text-bear"}>{formatSignedPercent(account.rangeReturnPct)}</span>
            </p>
          </div>
          <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            {account.openPositionCount} 持仓 · {account.orderCount} 条订单 · {account.closedTradeCount} 笔平仓 · 数据 {account.runtime.dataAsOf}
          </span>
        </div>
        <div className="h-[280px] rounded-[12px] bg-[#f1f7fc] px-2 py-4 sm:h-[340px]">
          {account.curve.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={account.curve} margin={{ left: 8, right: 8, top: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="paperEquityFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#2f7fbd" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#2f7fbd" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#dbe8f3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} minTickGap={34} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => moneyAxis(Number(value))} width={62} />
                <Tooltip content={<EquityTooltip />} />
                <Area type="monotone" dataKey="equity" stroke="#2f7fbd" strokeWidth={2.4} fill="url(#paperEquityFill)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="benchmarkEquity" stroke="#91a6b7" strokeWidth={1.4} fill="transparent" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-ink-muted">暂无可模拟资产曲线</div>
          )}
        </div>
        {account.openPositionCount === 0 && account.closedTradeCount === 0 && (
          <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
            {account.orderCount
              ? "模拟盘已经记录接入后的信号，但当前没有持仓；请看下方撮合流水，里面会标明是重复信号、仓位上限、现金不足还是平仓后空仓。"
              : "模拟盘已从接入时间开始记录；当前还没有接入后的策略成交，账户保持现金，等待下一次雷达信号或调仓窗口。"}
          </p>
        )}
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <MiniStat label="投入市值" value={formatMoney(account.investedValue)} />
          <MiniStat label="基准同期" value={formatSignedPercent(account.benchmarkReturnPct)} tone={account.benchmarkReturnPct >= 0 ? "good" : "bad"} />
          <MiniStat label="区间最大回撤" value={formatSignedPercent(account.maxDrawdownPct)} tone="bad" />
          <MiniStat label={winSnapshot.label} value={winSnapshot.value} tone={winSnapshot.tone} />
        </div>
      </section>

      <ExecutionAuditPanel audit={executionAudit} />

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <BadgeCheck className="size-4" aria-hidden />
            持仓
          </div>
          <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            {account.openPositionCount} 只 · 总市值 {formatMoney(account.investedValue)}
          </span>
        </div>
        <div className="grid gap-2 md:hidden">
          {account.positions.map((position) => (
            <PositionMobileCard
              key={position.symbol}
              position={position}
              entryTime={positionEntryTimes.get(position.symbol)}
              entryOrder={positionEntryOrders.get(position.symbol)}
            />
          ))}
          {account.positions.length === 0 && (
            <div className="rounded-[7px] border border-rule bg-[#fafafa] py-8 text-center text-sm text-ink-muted">
              当前策略处于空仓观察。
            </div>
          )}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1180px] border-collapse text-left text-[13px]">
            <thead className="border-b border-rule text-[11px] text-ink-muted">
              <tr>
                <th className="py-2 font-medium">股票</th>
                <th className="py-2 font-medium">买入时间（北京时间）</th>
                <th className="py-2 font-medium">信号来源</th>
                <th className="py-2 font-medium">持仓</th>
                <th className="py-2 font-medium">成本价</th>
                <th className="py-2 font-medium">现价</th>
                <th className="py-2 font-medium">市值</th>
                <th className="py-2 font-medium">浮盈</th>
                <th className="py-2 font-medium">止盈/止损参考</th>
                <th className="py-2 font-medium">可卖</th>
              </tr>
            </thead>
            <tbody>
              {account.positions.map((position) => {
                const entryOrder = positionEntryOrders.get(position.symbol)
                const risk = paperRiskPlan(position)
                return (
                  <tr key={position.symbol} className="border-b border-rule-soft last:border-0">
                    <td className="py-3">
                      <p className="font-medium text-ink">{position.name}</p>
                      <p className="mt-1 font-mono text-[11px] text-ink-faint">{position.symbol}</p>
                    </td>
                    <td className="py-3 font-mono text-[12px] text-ink-muted">
                      {formatPositionEntryTime(positionEntryTimes.get(position.symbol), position.openedAt)}
                    </td>
                    <td className="max-w-[260px] py-3 text-[12px] leading-5 text-ink-muted">
                      {formatPositionSignalSource(entryOrder)}
                    </td>
                    <td className="py-3 font-mono text-ink">{position.shares.toLocaleString("zh-CN")}</td>
                    <td className="py-3 font-mono text-ink">¥{position.costPrice.toFixed(2)}</td>
                    <td className="py-3 font-mono text-ink">¥{position.currentPrice.toFixed(2)}</td>
                    <td className="py-3 font-mono text-ink">{formatMoney(position.marketValue)}</td>
                    <td className={`py-3 font-mono ${position.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>
                      {formatSignedPercent(position.pnlPct)}
                    </td>
                    <td className="py-3 font-mono text-[11px] leading-5 text-ink-muted">
                      <span className="block text-health-ok">止盈 ¥{risk.takeProfit.toFixed(2)}</span>
                      <span className="block text-bear">止损 ¥{risk.stopLoss.toFixed(2)}</span>
                    </td>
                    <td className="py-3">
                      <span className={`rounded-[6px] px-2 py-1 font-mono text-[11px] ${
                        position.sellable ? "bg-[#e7f4eb] text-health-ok" : "bg-[#fff7ed] text-[#b45309]"
                      }`}>
                        {position.sellable ? position.sellableFrom : `T+1 ${position.sellableFrom}`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {account.positions.length === 0 && (
            <div className="rounded-[7px] border border-rule bg-[#fafafa] py-8 text-center text-sm text-ink-muted">
              当前策略处于空仓观察。
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <ClipboardList className="size-4" aria-hidden />
              Daily Review
            </div>
            <h3 className="mt-1 text-[17px] font-semibold text-ink">盘后复盘</h3>
            <p className="mt-2 max-w-[900px] text-[13px] leading-5 text-ink-muted">{dailyReview.summary}</p>
          </div>
          <span className="self-start rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            {dailyReview.date} · {dailyReview.status}
          </span>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <MiniStat label="持仓盈亏" value={`${dailyReview.winnerCount} 胜 / ${dailyReview.loserCount} 负`} tone={dailyReview.loserCount > dailyReview.winnerCount ? "bad" : "good"} />
          <MiniStat label="最弱持仓" value={dailyReview.worstLabel} tone={dailyReview.worstPnlPct < 0 ? "bad" : "good"} />
          <MiniStat label="同批次集中度" value={dailyReview.batchLabel} tone={dailyReview.largestBatchCount >= 4 ? "bad" : undefined} />
          <MiniStat label="投入仓位" value={formatSignedPercent(dailyReview.exposurePct).replace("+", "")} tone={dailyReview.exposurePct > 55 ? "bad" : undefined} />
        </div>

        <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-[11px] text-ink-muted">今日交易复盘</p>
              <p className="mt-1 text-[13px] leading-5 text-ink-muted">{dailyReview.orderSummary.narrative}</p>
            </div>
            <span className="self-start rounded-[7px] border border-rule bg-white px-3 py-2 font-mono text-[11px] text-ink-muted">
              {dailyReview.orderSummary.latestOrderTime}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <MiniStat label="买入成交" value={`${dailyReview.orderSummary.filledBuys} 笔`} tone={dailyReview.orderSummary.filledBuys > 0 ? "good" : undefined} />
            <MiniStat label="卖出成交" value={`${dailyReview.orderSummary.filledSells} 笔`} tone={dailyReview.orderSummary.filledSells > 0 ? "bad" : undefined} />
            <MiniStat label="跳过信号" value={`${dailyReview.orderSummary.skipped} 笔`} />
            <MiniStat label="拒单" value={`${dailyReview.orderSummary.rejected} 笔`} tone={dailyReview.orderSummary.rejected > 0 ? "bad" : undefined} />
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            <ReviewList title="今天买了" items={dailyReview.orderSummary.boughtNames} empty="今天没有买入成交。" />
            <ReviewList title="今天卖了" items={dailyReview.orderSummary.soldNames} empty="今天没有卖出成交。" />
            <ReviewList title="需要检查" items={dailyReview.orderSummary.checkItems} empty="没有需要优先检查的撮合问题。" />
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] text-ink-muted">重点复盘股票</p>
              <span className="font-mono text-[11px] text-ink-faint">按当前浮盈排序</span>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {dailyReview.focus.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  onClick={() => setSelectedChartSymbol(item.symbol)}
                  className="rounded-[7px] border border-rule bg-white px-3 py-3 text-left transition hover:border-[#b9d7ff] hover:bg-[#f7fbff]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-ink">{item.name}</p>
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">{item.symbol} · 买入 {item.entryTime}</p>
                    </div>
                    <span className={`shrink-0 font-mono text-[13px] ${item.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>
                      {formatSignedPercent(item.pnlPct)}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-ink-muted">
                    成本 ¥{item.costPrice.toFixed(2)} → 现价 ¥{item.currentPrice.toFixed(2)}
                  </p>
                  <p className="mt-2 text-[12px] leading-5 text-ink-muted">{item.diagnosis}</p>
                </button>
              ))}
              {dailyReview.focus.length === 0 && (
                <div className="rounded-[7px] border border-rule bg-white px-3 py-8 text-center text-sm text-ink-muted lg:col-span-2">
                  当前没有持仓，收盘后复盘会等待下一笔模拟成交。
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <p className="font-mono text-[11px] text-ink-muted">策略修正建议</p>
            <div className="mt-3 space-y-2">
              {dailyReview.actions.map((action) => (
                <div key={action.title} className="rounded-[7px] border border-rule bg-white px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-semibold text-ink">{action.title}</p>
                    <span className={`shrink-0 rounded-[6px] px-2 py-1 font-mono text-[10px] ${
                      action.severity === "high"
                        ? "bg-[#fae8e6] text-bear"
                        : action.severity === "medium"
                          ? "bg-[#fff8e7] text-warning"
                          : "bg-[#e7f4eb] text-health-ok"
                    }`}>
                      {action.severity === "high" ? "高" : action.severity === "medium" ? "中" : "低"}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-5 text-ink-muted">{action.detail}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Activity className="size-4" aria-hidden />
              交易 K 线
            </div>
            <p className="mt-2 max-w-[820px] text-[13px] leading-5 text-ink-muted">
              将接入后的买入、卖出、拒单和跳过信号叠加到真实日 K 线；用于复盘信号位置、T+1 约束和持仓盈亏。
            </p>
          </div>
          {selectedChart && (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
                {selectedChart.source === "missing" ? "K 线未缓存" : `${selectedChart.source} · ${selectedChart.latestDate ?? "N/A"}`}
              </span>
              {typeof selectedChart.currentPrice === "number" && (
                <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink">
                  现价 ¥{selectedChart.currentPrice.toFixed(2)}
                </span>
              )}
              {typeof selectedChart.pnlPct === "number" && (
                <span className={`rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] ${selectedChart.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>
                  盈亏 {formatSignedPercent(selectedChart.pnlPct)}
                </span>
              )}
            </div>
          )}
        </div>

        {account.tradeCharts.length > 0 ? (
          <>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {account.tradeCharts.map((chart) => {
                const active = chart.symbol === selectedChart?.symbol
                return (
                  <button
                    key={chart.symbol}
                    type="button"
                    onClick={() => setSelectedChartSymbol(chart.symbol)}
                    className={`shrink-0 rounded-[7px] border px-3 py-2 text-left transition ${
                      active ? "border-[#1e5a91] bg-[#f4f9ff] text-[#1e5a91]" : "border-rule bg-[#fafafa] text-ink hover:bg-white"
                    }`}
                  >
                    <span className="block text-[13px] font-medium">{chart.name}</span>
                    <span className="mt-1 block font-mono text-[10px] text-ink-muted">
                      {chart.symbol} · {chart.markers.length} 标记
                    </span>
                  </button>
                )
              })}
            </div>

            {selectedChart ? (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
                <TradingViewKLineChart chart={selectedChart} />
                <TradeMarkerLedger chart={selectedChart} />
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-[7px] border border-rule bg-[#fafafa] px-4 py-8 text-center text-sm text-ink-muted">
            当前模拟盘还没有可映射到股票的买卖记录；有订单或持仓后会自动显示交易 K 线。
          </div>
        )}
      </section>

      <details className="group rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <ShoppingCart className="size-4" aria-hidden />
              撮合流水
            </div>
            <p className="mt-1 text-[13px] leading-5 text-ink-muted">
              默认收起，展开后查看接入后的买入、卖出、跳过和拒单原因。
            </p>
          </div>
          <span className="inline-flex h-9 items-center gap-2 self-start rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink-muted sm:self-auto">
            最近 {Math.min(account.orders.length, 40)} / 总 {account.orderCount} 条
            <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="mt-4 grid gap-2 md:hidden">
          {account.orders.slice(0, 40).map((order) => (
            <OrderMobileCard key={order.orderId} order={order} />
          ))}
          {account.orders.length === 0 && (
            <div className="rounded-[7px] border border-rule bg-[#fafafa] py-8 text-center text-sm text-ink-muted">
              还没有接入后的订单流水；策略在线等待下一次雷达信号。
            </div>
          )}
        </div>
        <div className="mt-4 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
            <thead className="border-b border-rule text-[11px] text-ink-muted">
              <tr>
                <th className="py-2 font-medium">时间（北京时间）</th>
                <th className="py-2 font-medium">股票</th>
                <th className="py-2 font-medium">方向</th>
                <th className="py-2 font-medium">状态</th>
                <th className="py-2 font-medium">数量</th>
                <th className="py-2 font-medium">价格</th>
                <th className="py-2 font-medium">金额</th>
                <th className="py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {account.orders.slice(0, 40).map((order) => (
                <tr key={order.orderId} className="border-b border-rule-soft last:border-0">
                  <td className="py-3 font-mono text-[12px] text-ink-muted">{formatDateTime(order.submittedAt)}</td>
                  <td className="py-3">
                    <p className="font-medium text-ink">{order.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-ink-faint">{order.symbol}</p>
                  </td>
                  <td className={`py-3 font-mono ${order.side === "buy" ? "text-bull" : "text-bear"}`}>{order.side === "buy" ? "买入" : "卖出"}</td>
                  <td className="py-3"><OrderStatusBadge order={order} /></td>
                  <td className="py-3 font-mono text-ink">{order.filledShares ? order.filledShares.toLocaleString("zh-CN") : order.requestedShares.toLocaleString("zh-CN")}</td>
                  <td className="py-3 font-mono text-ink">¥{(order.filledPrice ?? order.limitPrice).toFixed(2)}</td>
                  <td className="py-3 font-mono text-ink">{formatMoney(order.amount)}</td>
                  <td className="py-3 text-[12px] leading-5 text-ink-muted">{order.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {account.orders.length === 0 && (
            <div className="rounded-[7px] border border-rule bg-[#fafafa] py-8 text-center text-sm text-ink-muted">
              还没有接入后的订单流水；策略在线等待下一次雷达信号。
            </div>
          )}
        </div>
      </details>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ListChecks className="size-4" aria-hidden />
            交易记录
          </div>
          <span className="font-mono text-[11px] text-ink-muted">最近 {Math.min(account.closedTrades.length, 30)} / 总 {account.closedTradeCount} 笔</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {account.closedTrades.slice(0, 30).map((trade, index) => (
            <div key={trade.tradeId ?? `${trade.symbol}-${trade.entryDate}-${trade.exitDate}-${index}`} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{trade.name} <span className="font-mono text-[11px] text-ink-muted">{trade.symbol}</span></p>
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">{trade.entryDate} → {trade.exitDate} · {trade.holdingDays} 日</p>
                </div>
                <span className={`font-mono text-[13px] ${trade.returnPct >= 0 ? "text-bull" : "text-bear"}`}>
                  {formatSignedPercent(trade.returnPct)}
                </span>
              </div>
              <p className="mt-2 font-mono text-[11px] text-ink-muted">超额 {formatSignedPercent(trade.alphaPct)} · {trade.exitReason}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function RadarConfluencePanel({ signals }: { signals: RadarConfluenceSignal[] }) {
  const visibleSignals = signals.slice(0, 12)

  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <GitMerge className="size-4" aria-hidden />
            Radar Confluence
          </div>
          <h3 className="mt-1 text-[17px] font-semibold text-ink">雷达共同推荐候选</h3>
          <p className="mt-2 max-w-[880px] text-[13px] leading-5 text-ink-muted">
            这一组来自策略雷达账本：同一股票被 2 个以上上线策略同向推荐。它是模拟盘成交前的上游候选；是否进入持仓，要看下方订单交集里的仓位、现金、T+1 和风控结果。
          </p>
        </div>
        <span className="self-start rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
          雷达账本 · {signals.length} 个交集
        </span>
      </div>

      {visibleSignals.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visibleSignals.map((signal) => (
            <Link
              key={signal.ticker}
              href="/radar"
              className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3 transition hover:border-[#b9d7ff] hover:bg-white"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{signal.name}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">
                    {signal.ticker} · 触发 {formatDateMinute(signal.triggerAt)}
                  </p>
                </div>
                <span className="shrink-0 rounded-[6px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
                  {signal.strategyCount} 策略
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-rule-soft pt-3">
                <ConfluenceInlineMetric label="信号" value={`${signal.signalCount} 条`} />
                <ConfluenceInlineMetric label="触发" value={formatRadarConfluencePrice(signal)} />
                <ConfluenceInlineMetric
                  label="触发后"
                  value={formatSignedPercent(signal.returnPct)}
                  tone={signal.returnPct >= 0 ? "good" : "bad"}
                />
              </div>

              <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-ink-muted">
                {signal.strategyNames.slice(0, 4).join("、")} 同向命中；成交与否以后续模拟盘订单为准。
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-8 text-center text-[13px] text-ink-muted">
          当前雷达快照没有 2 个以上策略共同推荐的候选；模拟盘仍按各策略独立账户运行。
        </div>
      )}
    </section>
  )
}

function PaperConfluencePanel({
  signals,
  rangeLabel,
}: {
  signals: PaperConfluenceSignal[]
  rangeLabel: string
}) {
  const visibleSignals = signals.slice(0, 12)

  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <GitMerge className="size-4" aria-hidden />
            Strategy Confluence
          </div>
          <h3 className="mt-1 text-[17px] font-semibold text-ink">多策略交集信号</h3>
          <p className="mt-2 max-w-[880px] text-[13px] leading-5 text-ink-muted">
            从所有已上线模拟账户的买入、跳过和拒单流水里汇总。同一股票被 2 个以上策略命中时进入这里；只有 2 个以上策略实际成交的信号才会进入“多策略共振”独立模拟账户，观察和风控阻断只作为执行解释。
          </p>
        </div>
        <span className="self-start rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
          {rangeLabel} · {signals.length} 条交集
        </span>
      </div>

      {visibleSignals.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visibleSignals.map((signal) => (
            <Link
              key={signal.symbol}
              href={simulationConfluenceHref(signal)}
              className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3 transition hover:border-[#b9d7ff] hover:bg-white"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{signal.name}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">{signal.symbol} · 触发 {formatDateMinute(signal.triggerAt)}</p>
                </div>
                <span className={`shrink-0 rounded-[6px] px-2 py-1 font-mono text-[10px] ${confluenceStatusClass(signal.status)}`}>
                  {signal.statusLabel}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-rule-soft pt-3">
                <ConfluenceInlineMetric label="策略" value={`${signal.strategyCount} 个`} />
                <ConfluenceInlineMetric
                  label="成交"
                  value={`${signal.filledStrategyCount} 个`}
                  tone={signal.filledStrategyCount > 0 ? "good" : undefined}
                />
                <ConfluenceInlineMetric label="触发" value={formatConfluencePrice(signal)} />
              </div>

              <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-ink-muted">{signal.note}</p>
              <p className="mt-2 font-mono text-[11px] text-ink-faint">
                订单 {signal.orderCount} · 成交额 {formatMoney(signal.totalAmount)}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[7px] border border-dashed border-rule bg-[#fafafa] px-4 py-8 text-center text-[13px] text-ink-muted">
          近期还没有 2 个以上策略同时命中的股票；单策略信号仍按各自模拟账户独立运行。
        </div>
      )}
    </section>
  )
}

type DailyReviewAction = {
  title: string
  detail: string
  severity: "high" | "medium" | "low"
}

type DailyReviewFocus = {
  symbol: string
  name: string
  entryTime: string
  costPrice: number
  currentPrice: number
  pnlPct: number
  diagnosis: string
}

type DailyReviewOrderSummary = {
  date: string
  filledBuys: number
  filledSells: number
  skipped: number
  rejected: number
  boughtNames: string[]
  soldNames: string[]
  checkItems: string[]
  latestOrderTime: string
  narrative: string
}

type ExecutionAuditMetric = {
  label: string
  value: string
  note: string
  tone?: "good" | "bad"
}

type ExecutionAudit = {
  latestEvent: string
  summary: string
  metrics: ExecutionAuditMetric[]
  checks: string[]
}

function ExecutionAuditPanel({ audit }: { audit: ExecutionAudit }) {
  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ListChecks className="size-4" aria-hidden />
            P2 · Execution Loop
          </div>
          <h3 className="mt-1 text-[17px] font-semibold text-ink">交易闭环对账</h3>
          <p className="mt-2 max-w-[900px] text-[13px] leading-5 text-ink-muted">{audit.summary}</p>
        </div>
        <span className="self-start rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
          {audit.latestEvent}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {audit.metrics.map((metric) => (
          <AuditMetricCard key={metric.label} metric={metric} />
        ))}
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {audit.checks.map((item) => (
          <div key={item} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
            {item}
          </div>
        ))}
      </div>
    </section>
  )
}

function AuditMetricCard({ metric }: { metric: ExecutionAuditMetric }) {
  const color = metric.tone === "good" ? "text-bull" : metric.tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{metric.label}</p>
      <p className={`mt-1 font-mono text-[16px] font-semibold ${color}`}>{metric.value}</p>
      <p className="mt-1 text-[11px] leading-4 text-ink-muted">{metric.note}</p>
    </div>
  )
}

function buildDailyReview(account: PaperAccount, entryTimes: Map<string, string>) {
  const positions = account.positions.slice().sort((a, b) => a.pnlPct - b.pnlPct)
  const winners = account.positions.filter((position) => position.pnlPct > 0)
  const losers = account.positions.filter((position) => position.pnlPct < 0)
  const worst = positions[0]
  const focus = positions.slice(0, Math.min(4, Math.max(positions.length, 0))).map((position) => reviewFocusItem(position, entryTimes))
  const batches = buildEntryBatches(account.positions, entryTimes)
  const largestBatch = batches[0]
  const exposurePct = account.currentEquity > 0 ? (account.investedValue / account.currentEquity) * 100 : 0
  const worstLabel = worst ? `${worst.name} ${formatSignedPercent(worst.pnlPct)}` : "无持仓"
  const batchLabel = largestBatch ? `${largestBatch.time} · ${largestBatch.count} 只` : "无成交"
  const orderSummary = buildDailyOrderSummary(account)
  const summary = dailyReviewSummary(account, worst, winners.length, losers.length, largestBatch, orderSummary)
  const actions = dailyReviewActions(account, worst, losers.length, largestBatch, exposurePct, orderSummary)

  return {
    date: orderSummary.date,
    status: account.openPositionCount > 0 ? "待复盘" : "观察中",
    summary,
    winnerCount: winners.length,
    loserCount: losers.length,
    worstLabel,
    worstPnlPct: worst?.pnlPct ?? 0,
    batchLabel,
    largestBatchCount: largestBatch?.count ?? 0,
    exposurePct,
    orderSummary,
    focus,
    actions,
  }
}

function buildExecutionAudit(account: PaperAccount): ExecutionAudit {
  const filledBuys = account.orders.filter((order) => order.status === "filled" && order.side === "buy")
  const filledSells = account.orders.filter((order) => order.status === "filled" && order.side === "sell")
  const skipped = account.orders.filter((order) => order.status === "skipped")
  const rejected = account.orders.filter((order) => order.status === "rejected")
  const duplicateSkips = skipped.filter((order) => order.side === "buy" && /重复|已有持仓/.test(order.note)).length
  const noPositionSells = skipped.filter((order) => order.side === "sell" && /没有对应持仓/.test(order.note)).length
  const t1Locked = skipped.filter((order) => /T\+1|T＋1|可卖/.test(order.note) && order.side === "sell").length
  const positionCapRejects = rejected.filter((order) => /仓位上限|60%/.test(order.note)).length
  const cashRejects = rejected.filter((order) => /现金|不足 100 股/.test(order.note)).length
  const latest = account.orders.slice().sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0]
  const checks = [
    filledBuys.length
      ? `信号已进入持仓：${compactOrderNames(filledBuys).join(" / ")}`
      : "暂无买入成交，若雷达有信号但这里为空，需要查模拟盘写账。",
    skipped.length
      ? `跳过 ${skipped.length} 笔：重复持仓 ${duplicateSkips}，T+1 锁定 ${t1Locked}，无持仓卖出 ${noPositionSells}。`
      : "没有跳过记录，当前链路没有重复信号或 T+1 锁定样本。",
    rejected.length
      ? `拒单 ${rejected.length} 笔：仓位上限 ${positionCapRejects}，现金/一手不足 ${cashRejects}。`
      : "没有拒单记录，仓位和现金约束暂未阻断交易。",
  ]

  return {
    latestEvent: latest ? `最新 ${formatDateTime(latest.submittedAt)}` : "暂无撮合事件",
    summary: account.orderCount
      ? `接入后共记录 ${account.orderCount} 条事件；本页加载最近 ${account.orders.length} 条，其中买入成交 ${filledBuys.length}，卖出成交 ${filledSells.length}，跳过 ${skipped.length}，拒单 ${rejected.length}；当前持仓 ${account.openPositionCount} 只，平仓 ${account.closedTradeCount} 笔。`
      : "接入后还没有形成撮合事件；系统会继续等待策略雷达信号，非交易时段保持空仓或原持仓监控。",
    metrics: [
      { label: "信号→买入", value: `${filledBuys.length} 成交`, note: "已从雷达信号进入订单并成交", tone: filledBuys.length > 0 ? "good" : undefined },
      { label: "卖出/平仓", value: `${filledSells.length} 成交`, note: "止盈、止损或到期退出", tone: filledSells.length > 0 ? "bad" : undefined },
      { label: "跳过/拒单", value: `${skipped.length}/${rejected.length}`, note: "重复、T+1、仓位或现金约束", tone: rejected.length > 0 ? "bad" : undefined },
      { label: "当前持仓", value: `${account.openPositionCount} 只`, note: `投入 ${formatMoney(account.investedValue)}`, tone: account.openPositionCount > 0 ? "good" : undefined },
    ],
    checks,
  }
}

function buildPaperWinSnapshot(account: PaperAccount): { label: string; value: string; tone?: "good" | "bad" } {
  if (account.closedTradeCount > 0) {
    return {
      label: "已平仓胜率",
      value: `${account.tradeWinRatePct.toFixed(1)}%`,
      tone: account.tradeWinRatePct >= 50 ? "good" : "bad",
    }
  }

  if (account.positions.length > 0) {
    const winners = account.positions.filter((position) => position.pnlPct > 0).length
    const rate = (winners / account.positions.length) * 100
    return {
      label: "持仓胜率",
      value: `${rate.toFixed(1)}%`,
      tone: rate >= 50 ? "good" : "bad",
    }
  }

  return { label: "胜率快照", value: "--" }
}

function reviewFocusItem(
  position: PaperAccount["positions"][number],
  entryTimes: Map<string, string>,
): DailyReviewFocus {
  return {
    symbol: position.symbol,
    name: position.name,
    entryTime: formatPositionEntryTime(entryTimes.get(position.symbol), position.openedAt),
    costPrice: position.costPrice,
    currentPrice: position.currentPrice,
    pnlPct: position.pnlPct,
    diagnosis: positionDiagnosis(position),
  }
}

function positionDiagnosis(position: PaperAccount["positions"][number]) {
  if (position.pnlPct <= -7) {
    return "单票浮亏已超过 7%，需要复查买入价是否追高、是否遇到跳空低开，并把该样本纳入止损/过滤规则优化。"
  }
  if (position.pnlPct <= -4) {
    return "浮亏进入预警区，先看是否跌破入场结构；若同批次多只走弱，要降低下一轮信号权重。"
  }
  if (position.pnlPct < 0) {
    return "轻微浮亏，重点观察是否仍守住触发价附近；暂时作为信号质量跟踪样本。"
  }
  if (position.pnlPct >= 5) {
    return "正反馈样本，复盘其触发前量价结构，用来提炼加分条件。"
  }
  return "小幅盈利，继续跟踪持仓质量和是否出现放量滞涨。"
}

function buildEntryBatches(positions: PaperAccount["positions"], entryTimes: Map<string, string>) {
  const counts = new Map<string, number>()
  for (const position of positions) {
    const time = formatPositionEntryTime(entryTimes.get(position.symbol), position.openedAt)
    counts.set(time, (counts.get(time) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => b.count - a.count || a.time.localeCompare(b.time))
}

function dailyReviewSummary(
  account: PaperAccount,
  worst: PaperAccount["positions"][number] | undefined,
  winnerCount: number,
  loserCount: number,
  largestBatch: { time: string; count: number } | undefined,
  orderSummary: DailyReviewOrderSummary,
) {
  if (!account.positions.length) {
    return orderSummary.filledBuys > 0 || orderSummary.filledSells > 0
      ? `今天已有 ${orderSummary.filledBuys} 笔买入、${orderSummary.filledSells} 笔卖出，当前空仓或等待下一轮信号。`
      : "今天没有持仓样本，复盘重点是策略是否正常在线、是否因为准入过滤或行情环境没有触发。"
  }

  const weakest = worst ? `最弱样本是 ${worst.name} ${formatSignedPercent(worst.pnlPct)}` : "暂无明显拖累样本"
  const batch = largestBatch && largestBatch.count >= 2
    ? `；其中 ${largestBatch.time} 同批次买入 ${largestBatch.count} 只，需要复盘这轮扫描的整体质量`
    : ""
  return `当前持仓 ${account.positions.length} 只，${winnerCount} 只盈利、${loserCount} 只浮亏；今日 ${orderSummary.filledBuys} 买入、${orderSummary.filledSells} 卖出、${orderSummary.rejected} 拒单，${weakest}${batch}。`
}

function dailyReviewActions(
  account: PaperAccount,
  worst: PaperAccount["positions"][number] | undefined,
  loserCount: number,
  largestBatch: { time: string; count: number } | undefined,
  exposurePct: number,
  orderSummary: DailyReviewOrderSummary,
): DailyReviewAction[] {
  const actions: DailyReviewAction[] = []

  if (worst && worst.pnlPct <= -7) {
    actions.push({
      title: "加入硬止损与入场后二次确认",
      detail: `${worst.name} 当前 ${formatSignedPercent(worst.pnlPct)}，这类样本应强制进入复盘池，检查是否需要把单票止损线、跳空低开过滤或触发后回撤阈值写入策略。`,
      severity: "high",
    })
  }

  if (largestBatch && largestBatch.count >= 4) {
    actions.push({
      title: "限制单轮扫描集中买入",
      detail: `${largestBatch.time} 同批次持仓 ${largestBatch.count} 只，说明信号可能受同一市场风格驱动；建议单轮最多成交 3-5 只，剩余进入观察池。`,
      severity: "medium",
    })
  }

  if (account.positions.length > 0 && loserCount / account.positions.length >= 0.45) {
    actions.push({
      title: "降低弱行情下的入场阈值",
      detail: `浮亏持仓占比达到 ${Math.round((loserCount / account.positions.length) * 100)}%，需要检查指数环境、行业强弱和量能过滤是否过松。`,
      severity: "medium",
    })
  }

  if (exposurePct > 55) {
    actions.push({
      title: "仓位接近上限，优先做汰弱留强",
      detail: `当前投入仓位约 ${exposurePct.toFixed(1)}%，新增信号应先和弱持仓比较，不应机械加仓。`,
      severity: "medium",
    })
  }

  if (orderSummary.rejected > 0) {
    actions.push({
      title: "复查今日拒单原因",
      detail: `今天有 ${orderSummary.rejected} 笔拒单，优先确认是否由仓位上限、涨跌停、现金不足或重复信号触发。`,
      severity: "medium",
    })
  }

  if (orderSummary.skipped >= 5 && orderSummary.filledBuys === 0) {
    actions.push({
      title: "跳过信号过多，检查过滤阈值",
      detail: `今天 ${orderSummary.skipped} 笔信号被跳过但无买入成交，可能是重复信号、持仓约束或策略候选质量不足。`,
      severity: "medium",
    })
  }

  if (!actions.length) {
    actions.push({
      title: "保留当前策略参数，继续积累样本",
      detail: "当前没有明显异常拖累，先记录今日样本，等待更多交易日后再做参数调整，避免过早过拟合。",
      severity: "low",
    })
  }

  return actions
}

function buildDailyOrderSummary(account: PaperAccount): DailyReviewOrderSummary {
  const reviewDate = account.runtime.dataAsOf || account.rangeEnd || formatChinaDate(new Date())
  const todayOrders = account.orders.filter((order) => formatChinaDate(order.submittedAt) === reviewDate)
  const filledBuys = todayOrders.filter((order) => order.status === "filled" && order.side === "buy")
  const filledSells = todayOrders.filter((order) => order.status === "filled" && order.side === "sell")
  const skipped = todayOrders.filter((order) => order.status === "skipped")
  const rejected = todayOrders.filter((order) => order.status === "rejected")
  const latest = todayOrders.slice().sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0]
  const boughtNames = compactOrderNames(filledBuys)
  const soldNames = compactOrderNames(filledSells)
  const checkItems = [
    ...compactOrderNames(rejected).map((name) => `拒单：${name}`),
    ...skipped.slice(0, 3).map((order) => `跳过：${order.name} · ${shortOrderNote(order.note)}`),
  ]
  const narrative = todayOrders.length
    ? `按 ${reviewDate} 北京时间统计，今天记录 ${todayOrders.length} 条撮合事件，其中成交买入 ${filledBuys.length} 笔、成交卖出 ${filledSells.length} 笔。`
    : `按 ${reviewDate} 北京时间统计，今天还没有新的撮合流水；若市场已开盘，需要检查雷达信号、后台心跳和模拟盘写入。`

  return {
    date: reviewDate,
    filledBuys: filledBuys.length,
    filledSells: filledSells.length,
    skipped: skipped.length,
    rejected: rejected.length,
    boughtNames,
    soldNames,
    checkItems,
    latestOrderTime: latest ? `最新 ${formatDateTime(latest.submittedAt)}` : "暂无今日流水",
    narrative,
  }
}

function compactOrderNames(orders: PaperOrder[]) {
  return orders.slice(0, 6).map((order) => `${order.name} ${order.symbol}`)
}

function shortOrderNote(note: string) {
  return note.length > 26 ? `${note.slice(0, 26)}...` : note
}

function ReviewList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-ink-muted">{title}</p>
        <span className="font-mono text-[10px] text-ink-faint">{items.length}</span>
      </div>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="rounded-[6px] border border-rule-soft bg-[#fafafa] px-2.5 py-2 text-[12px] leading-5 text-ink-muted">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 rounded-[6px] border border-dashed border-rule bg-[#fafafa] px-2.5 py-5 text-center text-[12px] text-ink-faint">
          {empty}
        </p>
      )}
    </div>
  )
}

function OrderMobileCard({ order }: { order: PaperOrder }) {
  return (
    <article className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{order.name}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">{order.symbol} · {formatDateTime(order.submittedAt)}</p>
        </div>
        <OrderStatusBadge order={order} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MobileField label="方向" value={order.side === "buy" ? "买入" : "卖出"} toneClass={order.side === "buy" ? "text-bull" : "text-bear"} />
        <MobileField label="数量" value={(order.filledShares ? order.filledShares : order.requestedShares).toLocaleString("zh-CN")} />
        <MobileField label="价格" value={`¥${(order.filledPrice ?? order.limitPrice).toFixed(2)}`} />
        <MobileField label="金额" value={formatMoney(order.amount)} />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-ink-muted">{order.note}</p>
    </article>
  )
}

function PositionMobileCard({
  position,
  entryTime,
  entryOrder,
}: {
  position: PaperAccount["positions"][number]
  entryTime?: string
  entryOrder?: PaperOrder
}) {
  const risk = paperRiskPlan(position)
  return (
    <article className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{position.name}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            {position.symbol} · 买入 {formatPositionEntryTime(entryTime, position.openedAt)}
          </p>
        </div>
        <span className={`shrink-0 font-mono text-[13px] ${position.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>
          {formatSignedPercent(position.pnlPct)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MobileField label="持仓" value={position.shares.toLocaleString("zh-CN")} />
        <MobileField label="成本价" value={`¥${position.costPrice.toFixed(2)}`} />
        <MobileField label="现价" value={`¥${position.currentPrice.toFixed(2)}`} />
        <MobileField label="市值" value={formatMoney(position.marketValue)} />
        <MobileField label="止盈参考" value={`¥${risk.takeProfit.toFixed(2)}`} toneClass="text-health-ok" />
        <MobileField label="止损参考" value={`¥${risk.stopLoss.toFixed(2)}`} toneClass="text-bear" />
      </div>
      <p className="mt-3 rounded-[6px] border border-rule bg-white px-2.5 py-2 text-[12px] leading-5 text-ink-muted">
        {formatPositionSignalSource(entryOrder)}
      </p>
      <div className="mt-3">
        <span className={`rounded-[6px] px-2 py-1 font-mono text-[11px] ${
          position.sellable ? "bg-[#e7f4eb] text-health-ok" : "bg-[#fff7ed] text-[#b45309]"
        }`}>
          {position.sellable ? `可卖 ${position.sellableFrom}` : `T+1 ${position.sellableFrom}`}
        </span>
      </div>
    </article>
  )
}

function paperRiskPlan(position: PaperAccount["positions"][number]) {
  const stopLoss = Math.max(0, position.costPrice * 0.93)
  const takeProfit = Math.max(position.costPrice, position.costPrice * 1.08)
  return {
    stopLoss,
    takeProfit,
  }
}

function formatPositionSignalSource(order?: PaperOrder) {
  if (!order) return "入场信号待确认；请展开撮合流水查看原始订单。"
  const source = order.signalId ? `信号 ${order.signalId.slice(-8)}` : "雷达入场"
  return `${source} · ${shortOrderNote(order.note)}`
}

function MobileField({ label, value, toneClass = "text-ink" }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2.5 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 break-words font-mono text-[12px] tabular ${toneClass}`}>{value}</p>
    </div>
  )
}

function buildPositionEntryTimes(orders: PaperOrder[]) {
  const bySymbol = new Map<string, string>()
  for (const order of buildPositionEntryOrders(orders).values()) {
    bySymbol.set(order.symbol, order.filledAt ?? order.submittedAt)
  }
  return bySymbol
}

function buildPositionEntryOrders(orders: PaperOrder[]) {
  const bySymbol = new Map<string, PaperOrder>()
  const filledBuys = orders
    .filter((order) => order.side === "buy" && order.status === "filled")
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())

  for (const order of filledBuys) bySymbol.set(order.symbol, order)
  return bySymbol
}

function TradeMarkerLedger({ chart }: { chart: PaperTradeChart }) {
  return (
    <aside className="rounded-[12px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">{chart.name}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">{chart.symbol} · {chart.markers.length} 个交易标记</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {chart.markers.slice(-12).reverse().map((marker) => (
          <div key={marker.id} className="rounded-[7px] border border-rule bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className={`font-mono text-[12px] ${marker.side === "buy" ? "text-bull" : "text-bear"}`}>
                {marker.label}
              </span>
              <span className="font-mono text-[11px] text-ink-muted">{marker.date}</span>
            </div>
            <p className="mt-2 font-mono text-[13px] text-ink">
              ¥{marker.price.toFixed(2)} · {marker.shares ? marker.shares.toLocaleString("zh-CN") : 0} 股
            </p>
            <p className="mt-1 text-[11px] leading-4 text-ink-muted">{marker.note}</p>
          </div>
        ))}
        {chart.markers.length === 0 && (
          <div className="rounded-[7px] border border-rule bg-white px-3 py-8 text-center text-sm text-ink-muted">
            该股票暂无交易标记。
          </div>
        )}
      </div>
    </aside>
  )
}

function RangeLink({ account, range }: { account: PaperAccount; range: PaperRange }) {
  const active = account.range === range
  return (
    <Link
      href={simulationHref(account.strategyId, range, account.startedAt)}
      className={`inline-flex h-9 items-center rounded-full border px-3 text-[12px] font-medium transition ${
        active ? "border-[#b9d7ff] bg-[#eaf4ff] text-[#1e5a91]" : "border-rule bg-white text-ink-muted hover:bg-[#f4f9ff]"
      }`}
    >
      {range === "1m" ? "近一月" : range === "3m" ? "近三月" : "交易至今"}
    </Link>
  )
}

function RuntimeStamp({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1 font-mono text-[12px] text-ink">{value || "N/A"}</p>
    </div>
  )
}

const PAPER_START_STORAGE_PREFIX = "stock-radar.paper-started-at.v1:"

type PaperAutoRefreshState = {
  visible: boolean
  tone: "neutral" | "good" | "bad"
  label: string
  detail: string
}

function usePaperAutoRefresh(account: PaperAccount): PaperAutoRefreshState {
  const router = useRouter()
  const strategyId = account.strategyId
  const range = account.range
  const startedAt = account.startedAt
  const heartbeatAt = account.runtime.heartbeatAt
  const runtimeState = account.runtime.state
  const ledgerStatus = account.ledger.status
  const orderCount = account.orderCount
  const openPositionCount = account.openPositionCount
  const closedTradeCount = account.closedTradeCount
  const [state, setState] = useState<PaperAutoRefreshState>({
    visible: false,
    tone: "neutral",
    label: "",
    detail: "",
  })

  useEffect(() => {
    if (!shouldAutoRefreshPaper({
      strategyId,
      ledgerStatus,
      heartbeatAt,
      runtimeState,
      orderCount,
      openPositionCount,
      closedTradeCount,
    }) || typeof window === "undefined") return

    const key = `stock-radar.paper-auto-refresh.v2:${strategyId}:${range}`
    const last = Number(window.sessionStorage.getItem(key) ?? 0)
    if (Number.isFinite(last) && Date.now() - last < PAPER_AUTO_REFRESH_COOLDOWN_MS) return

    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 55_000)
    window.sessionStorage.setItem(key, String(Date.now()))

    async function refresh() {
      try {
        await Promise.resolve()
        if (cancelled) return
        setState({
          visible: true,
          tone: "neutral",
          label: "自动同步中",
          detail: "正在把最新雷达信号补入当前模拟账户，完成后会自动更新页面。",
        })
        const response = await fetch("/api/paper-trading/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyId,
            range,
            startedAt,
          }),
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload?.ok === false) {
          throw new Error(typeof payload?.error === "string" ? payload.error : "自动同步失败")
        }
        if (cancelled) return
        setState({
          visible: true,
          tone: "good",
          label: "同步完成",
          detail: `已校验 ${payload.signalCount ?? 0} 条信号、${payload.orderCount ?? 0} 条订单，正在刷新页面快照。`,
        })
        router.refresh()
      } catch (error) {
        if (cancelled) return
        setState({
          visible: true,
          tone: "bad",
          label: "同步失败",
          detail: error instanceof Error && error.name === "AbortError"
            ? "自动同步超过 55 秒，页面保留当前账本快照；可以稍后再打开或手动重新接入。"
            : error instanceof Error ? error.message : "自动同步失败，请稍后重试。",
        })
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void refresh()

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [
    strategyId,
    range,
    startedAt,
    heartbeatAt,
    runtimeState,
    ledgerStatus,
    orderCount,
    openPositionCount,
    closedTradeCount,
    router,
  ])

  return state
}

function shouldAutoRefreshPaper(account: {
  strategyId: string
  ledgerStatus?: string
  heartbeatAt: string
  runtimeState: PaperAccount["runtime"]["state"]
  orderCount: number
  openPositionCount: number
  closedTradeCount: number
}) {
  if (!account.strategyId) return false
  if (account.ledgerStatus === "closed") return false

  const heartbeatMs = new Date(account.heartbeatAt).getTime()
  if (!Number.isFinite(heartbeatMs)) return true

  const ageMs = Date.now() - heartbeatMs
  const staleLimit = account.runtimeState === "running" ? 3 * 60 * 1000 : 15 * 60 * 1000
  const hasNoLedgerSignals = account.orderCount === 0 && account.openPositionCount === 0 && account.closedTradeCount === 0
  return hasNoLedgerSignals || ageMs > staleLimit || account.runtimeState === "stale"
}

function usePaperStartKeeper(strategyId: string, serverStartedAt: string) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!strategyId || typeof window === "undefined") return
    const params = new URLSearchParams(searchParams.toString())
    const current = params.get("startedAt")
    const key = `${PAPER_START_STORAGE_PREFIX}${strategyId}`

    if (current && current !== "now") {
      window.localStorage.setItem(key, current)
      if (!params.get("strategy")) {
        params.set("strategy", strategyId)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }
      return
    }

    let startedAt = window.localStorage.getItem(key)
    if (!startedAt || !Number.isFinite(new Date(startedAt).getTime()) || current === "now") {
      startedAt = serverStartedAt || new Date().toISOString()
      window.localStorage.setItem(key, startedAt)
    }

    params.set("startedAt", startedAt)
    if (!params.get("strategy")) params.set("strategy", strategyId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams, serverStartedAt, strategyId])
}

function simulationHref(strategyId: string | null | undefined, range: PaperRange, startedAt?: string | null) {
  const params = new URLSearchParams({ range })
  if (strategyId) params.set("strategy", strategyId)
  if (startedAt) params.set("startedAt", startedAt)
  return `/simulation?${params.toString()}`
}

function prioritizePaperOptions(options: PaperAccount["options"], activeStrategyId: string) {
  return options.slice().sort((a, b) => {
    const aScore = paperOptionPriority(a, activeStrategyId)
    const bScore = paperOptionPriority(b, activeStrategyId)
    if (bScore !== aScore) return bScore - aScore
    return (
      (b.positionCount ?? 0) - (a.positionCount ?? 0) ||
      (b.orderCount ?? 0) - (a.orderCount ?? 0) ||
      b.score - a.score
    )
  })
}

function paperOptionPriority(option: PaperAccount["options"][number], activeStrategyId: string) {
  if (option.id === activeStrategyId) return 1_000
  if (option.id === PAPER_CONFLUENCE_STRATEGY_ID) return 900
  if ((option.positionCount ?? 0) > 0) return 500
  if ((option.orderCount ?? 0) > 0) return 300
  return Math.max(0, option.score)
}

function simulationResetHref(strategyId: string, range: PaperRange) {
  const params = new URLSearchParams({
    strategy: strategyId,
    range,
    startedAt: "now",
    reset: "1",
  })
  return `/simulation?${params.toString()}`
}

function ledgerPillLabel(account: PaperAccount) {
  if (account.ledger.persisted) return "postgres ledger"
  if (account.ledger.driver === "postgres") return "postgres loading"
  return "local ledger"
}

function ledgerPillClass(account: PaperAccount) {
  if (account.ledger.persisted) return "bg-[#e7f4eb] text-health-ok"
  if (account.ledger.driver === "postgres") return "bg-[#eef4fa] text-[#1e5a91]"
  return "bg-[#fafafa] text-ink-muted"
}

function autoRefreshPillClass(tone: PaperAutoRefreshState["tone"]) {
  if (tone === "good") return "bg-[#e7f4eb] text-health-ok"
  if (tone === "bad") return "bg-[#fae8e6] text-bear"
  return "bg-[#eef4fa] text-[#1e5a91]"
}

function simulationConfluenceHref(signal: PaperConfluenceSignal) {
  void signal
  return `/simulation?strategy=${encodeURIComponent(PAPER_CONFLUENCE_STRATEGY_ID)}`
}

function confluenceStatusClass(status: PaperConfluenceSignal["status"]) {
  if (status === "filled") return "bg-[#e7f4eb] text-health-ok"
  if (status === "blocked") return "bg-[#fae8e6] text-bear"
  return "bg-[#eef4fa] text-[#1e5a91]"
}

function formatConfluencePrice(signal: PaperConfluenceSignal) {
  const price = signal.triggerPrice ?? signal.avgPrice ?? signal.referencePrice
  if (!price || !Number.isFinite(price)) return "--"
  return `¥${price.toFixed(price >= 100 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}`
}

function formatRadarConfluencePrice(signal: RadarConfluenceSignal) {
  const price = signal.triggerPrice ?? signal.latestPrice
  if (!price || !Number.isFinite(price)) return "--"
  return `¥${price.toFixed(price >= 100 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "")}`
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  tone?: "good" | "bad"
}) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-[#173b66]"
  return (
    <div className="rounded-[7px] border border-rule bg-white px-4 py-4 shadow-sm shadow-black/[0.02]">
      <div className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      <p className={`mt-3 font-mono text-[26px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function BacktestProfileStrip({ profile }: { profile: PaperBacktestProfile }) {
  return (
    <section className="grid gap-2 rounded-[7px] border border-rule bg-white px-4 py-4 md:grid-cols-5 md:px-5">
      <BacktestProfileCell label="回测状态" value={profile.status} detail={profile.source} />
      <BacktestProfileCell
        label="回测准入分"
        value={formatBacktestScore(profile.score)}
        tone={profile.score >= 50 ? "good" : profile.score > 0 ? "bad" : "neutral"}
      />
      <BacktestProfileCell
        label="年化收益"
        value={formatSignedPercent(profile.annualReturnPct)}
        tone={profile.annualReturnPct >= 10 ? "good" : profile.annualReturnPct < 0 ? "bad" : "neutral"}
      />
      <BacktestProfileCell
        label="最大回撤"
        value={formatDrawdown(profile.maxDrawdownPct)}
        tone={profile.maxDrawdownPct > 25 ? "bad" : "good"}
      />
      <BacktestProfileCell
        label="胜率 / 夏普"
        value={`${profile.winRatePct.toFixed(0)}% / ${profile.sharpe.toFixed(2)}`}
        detail={profile.period || "历史回测口径"}
      />
    </section>
  )
}

function BacktestProfileCell({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string
  value: string
  detail?: string
  tone?: "good" | "bad" | "neutral"
}) {
  const color = tone === "good" ? "text-health-ok" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="min-w-0 rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 truncate font-mono text-[16px] font-semibold ${color}`}>{value}</p>
      {detail && <p className="mt-1 truncate text-[11px] text-ink-muted">{detail}</p>}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[16px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function ConfluenceInlineMetric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 truncate font-mono text-[12px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function OrderStatusBadge({ order }: { order: PaperOrder }) {
  const className = order.status === "filled"
    ? "border-[#c8ead2] bg-[#e7f4eb] text-health-ok"
    : order.status === "rejected"
      ? "border-[#f0cbc6] bg-[#fae8e6] text-bear"
      : "border-[#d9e7f5] bg-[#eef4fa] text-[#1e5a91]"
  const label = order.status === "filled" ? "已成交" : order.status === "rejected" ? "已拒单" : "已跳过"
  return (
    <span className={`inline-flex h-7 items-center rounded-[7px] border px-2 font-mono text-[11px] ${className}`}>
      {label}
    </span>
  )
}

function runtimePillClass(tone: PaperAccount["runtime"]["tone"]) {
  if (tone === "good") return "bg-[#e7f4eb] text-health-ok"
  if (tone === "warning") return "bg-[#fff8e7] text-warning"
  if (tone === "bad") return "bg-[#fae8e6] text-bear"
  return "bg-[#eef4fa] text-[#1e5a91]"
}

function runtimeDotClass(tone: PaperAccount["runtime"]["tone"]) {
  if (tone === "good") return "bg-health-ok shadow-[0_0_0_3px_rgba(79,122,90,0.14)]"
  if (tone === "warning") return "bg-warning shadow-[0_0_0_3px_rgba(166,112,31,0.14)]"
  if (tone === "bad") return "bg-bear shadow-[0_0_0_3px_rgba(192,57,43,0.14)]"
  return "bg-[#1e5a91] shadow-[0_0_0_3px_rgba(30,90,145,0.12)]"
}

function checkToneClass(tone: PaperAccount["runtime"]["tone"]) {
  if (tone === "good") return "text-bull"
  if (tone === "warning") return "text-warning"
  if (tone === "bad") return "text-bear"
  return "text-ink"
}

function EquityTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: PaperEquityPoint }>; label?: string }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] shadow-sm">
      <p className="font-mono text-ink">{label}</p>
      <p className="mt-1 text-[#1e5a91]">模拟资产 {formatMoney(item.equity)}</p>
      <p className="text-ink-muted">区间收益 {formatSignedPercent(item.returnPct)}</p>
      <p className="text-ink-muted">回撤 {formatSignedPercent(item.drawdownPct)}</p>
    </div>
  )
}

function formatMoney(value: number) {
  if (Math.abs(value) >= 10_000) return `¥${(value / 10_000).toFixed(2)}万`
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function moneyAxis(value: number) {
  return `${(value / 10_000).toFixed(0)}万`
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatBacktestScore(value: number) {
  return value ? `${Math.round(value)}` : "待补"
}

function formatDrawdown(value: number) {
  return value ? `-${Math.abs(value).toFixed(2)}%` : "0.00%"
}

function formatDateTime(value: string) {
  return formatBeijingDateTime(value, { seconds: true })
}

function formatDateMinute(value: string) {
  return formatBeijingDateTime(value)
}

function formatPositionEntryTime(entryTime: string | undefined, openedAt: string) {
  return entryTime ? formatDateMinute(entryTime) : `${CHINA_TIME_LABEL} ${openedAt}`
}
