import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { StrategyMinerConfigPanel } from "@/components/strategy-miner/strategy-miner-config-panel"
import { StrategyPipelineStrip } from "@/components/strategies/strategy-pipeline-strip"
import { DEFAULT_STRATEGY_MINER_CONFIG, getStrategyMinerConfig } from "@/lib/strategy-miner-config"

export const metadata = {
  title: "策略矿工配置 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default async function StrategyMinerSettingsPage() {
  const config = await getStrategyMinerConfig()

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 2"
        layerEn="Strategy Miner"
        title="策略矿工配置"
        subtitle="设置策略矿工的外部搜索源、候选规模和即时回测数量；保存后会被策略研究页、定时任务和手动刷新统一使用。"
      />
      <StrategyPipelineStrip
        current="research"
        summary="配置只控制候选发现与回测节奏，不改变策略准入门槛。"
      />
      <StrategyMinerConfigPanel initialConfig={config} defaults={DEFAULT_STRATEGY_MINER_CONFIG} />
    </PageShell>
  )
}
