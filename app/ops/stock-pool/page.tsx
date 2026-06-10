import { StockPoolConfigPanel } from "@/components/ops/stock-pool-config-panel"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"

export const metadata = {
  title: "股票池配置 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default function StockPoolConfigPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Ops"
        layerEn="Universe"
        title="股票池配置"
        subtitle="管理统一股票池的查询、手工加入、排除名单和自动过滤规则；雷达扫描、数据预热和实时行情采样会读取这里的运行时股票池。"
      />
      <StockPoolConfigPanel />
    </PageShell>
  )
}
