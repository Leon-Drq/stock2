import { DATA_SOURCES } from "@/lib/catalog"
import { getHealthReport } from "@/lib/data-health"
import { DataOverviewChart } from "@/components/data/data-overview-chart"
import { RefreshButton } from "@/components/data/refresh-button"

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export async function DataHealthSection() {
  const report = await getHealthReport()

  if (!report.apiKeyConfigured) {
    return (
      <section className="mt-5 rounded-[7px] border border-health-bad/30 bg-health-bad/[0.03] px-4 py-4 md:px-5">
        <p className="font-mono text-[11px] text-health-bad">
          API Key 未配置
        </p>
        <p className="mt-2 text-[15px] text-ink">
          请在项目环境变量中设置 <code className="font-mono text-[13px]">QVERIS_API_KEY</code>
          ，否则无法监控数据源可用性。
        </p>
      </section>
    )
  }

  return (
    <>
      {/* 采样状态条 */}
      <div className="mt-5 flex flex-col gap-2 rounded-[7px] border border-rule bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">
          实时采样自 Qveris · 5 分钟刷新一次
        </p>
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-ink-faint">
            采样于 {formatAge(report.checkedAt)}
          </p>
          <RefreshButton />
        </div>
      </div>

      <DataOverviewChart report={report} />
    </>
  )
}

export function DataHealthFallback() {
  return (
    <>
      <div className="mt-5 flex items-center justify-between rounded-[7px] border border-rule bg-white px-4 py-3 md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">
          实时采样自 Qveris · 5 分钟刷新一次
        </p>
        <p className="font-mono text-[11px] text-ink-faint animate-pulse">采样中…</p>
      </div>
      <section className="mt-5">
        <div className="grid grid-cols-2 gap-y-4 rounded-[7px] border border-rule bg-white px-5 py-4 sm:grid-cols-4 sm:px-6">
          {["数据源", "状态", "工具", "健康率"].map((label) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                {label}
              </span>
              <span className="font-sans text-2xl font-semibold text-ink-faint">—</span>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {DATA_SOURCES.map((d) => (
            <article key={d.id} className="flex flex-col gap-3 rounded-[7px] border border-rule bg-white p-4">
              <header>
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 animate-pulse rounded-full bg-ink-faint" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
                    采样中
                  </span>
                </div>
                <h3 className="mt-1.5 font-sans text-[15px] font-semibold text-ink">{d.name}</h3>
                <p className="font-mono text-[10px] tracking-wider text-ink-faint">
                  {d.category} · {d.freq.split(/[/\s]/)[0]}
                </p>
              </header>
              <div className="h-16 border-t border-rule-soft" />
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
