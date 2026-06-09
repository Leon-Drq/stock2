import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { CronControlPanel } from "@/components/ops/cron-control-panel"

export const metadata = {
  title: "定时任务配置 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default function CronOpsPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Ops"
        layerEn="Scheduler"
        title="定时任务配置"
        subtitle="管理 Python 任务调度器里的任务启停、执行周期和手动执行。任务配置写入 PostgreSQL，worker 通过数据库轮询加载。"
      />
      <CronControlPanel />
    </PageShell>
  )
}
