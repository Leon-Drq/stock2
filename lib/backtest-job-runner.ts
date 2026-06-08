import { runStrategyBacktestReports } from "@/lib/backtest"
import { runStrategyMiningCandidateBacktest } from "@/lib/strategy-miner"
import {
  completeBacktestJob,
  failBacktestJob,
  getQueuedBacktestJob,
  markBacktestJobRunning,
  syncStrategyRegistryFromReports,
  type BacktestJobRecord,
} from "@/lib/strategy-registry-store"

export async function runNextBacktestJob(jobId?: string) {
  const job = await getQueuedBacktestJob(jobId)
  if (!job) {
    return { ok: true, skipped: true, reason: "没有排队中的回测任务" }
  }
  if (job.status === "running") {
    return { ok: true, skipped: true, job, reason: "任务正在运行" }
  }
  if (job.status !== "queued") {
    return { ok: false, job, error: `任务状态不是 queued：${job.status}` }
  }

  await markBacktestJobRunning(job.jobId)
  try {
    const result = await executeJob(job)
    await completeBacktestJob(job.jobId, {
      reportCount: result.reportCount,
      summary: result.summary,
      reportPayload: result.payload,
    })
    return { ok: true, job: { ...job, status: "succeeded" as const }, ...result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failBacktestJob(job.jobId, message)
    return { ok: false, job: { ...job, status: "failed" as const }, error: message }
  }
}

async function executeJob(job: BacktestJobRecord) {
  if (job.kind === "mine") {
    if (!job.strategyId) throw new Error("矿工回测任务缺少 strategyId")
    const result = await runStrategyMiningCandidateBacktest(job.strategyId, {
      persist: true,
      maxCandidates: 24,
      githubLimitPerQuery: 4,
    })
    const reports = result.candidate?.report ? [result.candidate.report] : []
    await syncStrategyRegistryFromReports(reports, job.jobId)
    return {
      reportCount: reports.length,
      summary: reports.length ? `矿工候选 ${job.strategyId} 已完成真实回测。` : `未找到矿工候选 ${job.strategyId}。`,
      payload: {
        generatedAt: result.generatedAt,
        strategyId: job.strategyId,
        notes: result.notes,
        candidate: result.candidate
          ? {
              strategyId: result.candidate.strategy.id,
              name: result.candidate.strategy.name,
              status: result.candidate.status,
              metrics: result.candidate.metrics,
              admission: result.candidate.report?.diagnosis.admission,
            }
          : null,
      },
    }
  }

  const batch = await runStrategyBacktestReports()
  await syncStrategyRegistryFromReports(batch.reports, job.jobId)
  return {
    reportCount: batch.reports.length,
    summary: `策略目录 ${batch.reports.length} 个策略已完成真实回测并同步注册表。`,
    payload: {
      generatedAt: batch.generatedAt,
      notes: batch.notes,
      reports: batch.reports,
    },
  }
}
