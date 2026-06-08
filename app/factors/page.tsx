import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { FactorsClient } from "@/components/factors/factors-client"
import { FACTORS } from "@/lib/catalog"

export const metadata = {
  title: "因子资产库 — Stock Radar",
}

export default function FactorsPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 1"
        layerEn="Factor Library"
        title="因子资产库"
        subtitle="这里只放可复用的因子资产：已验证、观察中、数据待补、相关性重复和暂停使用会分开标记。新的自然语言想法先进入因子实验台，完成字段绑定和单因子验证后再沉淀到这里。"
      />
      <FactorsClient factors={FACTORS} />
    </PageShell>
  )
}
