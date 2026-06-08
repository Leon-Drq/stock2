import { DiscoverClient } from "@/components/discover/discover-client"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"

export const metadata = {
  title: "Qveris 能力探针 — Stock Radar",
  description: "用自然语言搜索 Qveris.ai 上的 A 股相关数据工具，查看参数 schema，并可试调用。",
}

export default function DiscoverPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Capability Probe"
        layerEn="No.001"
        title="Qveris 能力探针"
        subtitle="用自然语言 discover 拿到工具列表与参数 schema，再决定是否 call 执行。本页用于探查 A 股相关工具是否存在、参数如何传、以及实际响应结构。"
      />
      <DiscoverClient />
    </PageShell>
  )
}
