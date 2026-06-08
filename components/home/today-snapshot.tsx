import Link from "next/link"
import { unstable_cache } from "next/cache"
import { ArrowRight, Activity } from "lucide-react"
import { resolveWithFallback } from "@/lib/async-timeout"
import { CHINA_TIME_LABEL, formatChinaDateTime } from "@/lib/format"
import { fetchMarketIndexes, type MarketIndexesResult, type MarketIndexQuote } from "@/lib/market-indexes"

const INDEX_FALLBACK_QUOTES: MarketIndexQuote[] = [
  { code: "000001", codeQveris: "000001.SH", name: "上证指数", value: null, changePct: null },
  { code: "399001", codeQveris: "399001.SZ", name: "深证成指", value: null, changePct: null },
  { code: "399006", codeQveris: "399006.SZ", name: "创业板指", value: null, changePct: null },
  { code: "000905", codeQveris: "000905.SH", name: "中证500", value: null, changePct: null },
]
const getCachedMarketIndexes = unstable_cache(
  async () => fetchMarketIndexes(),
  ["home-market-indexes:v2"],
  { revalidate: 300 },
)

export async function TodaySnapshot() {
  const report = await resolveWithFallback(getCachedMarketIndexes(), {
    timeoutMs: 2_500,
    onFallback: (reason, error) => indexFallbackReport(reason, error),
  })
  const updatedAt = formatUpdatedAt(report.fetchedAt)
  const sourceLabel =
    report.source === "qveris"
      ? "Qveris 真实行情"
      : report.source === "database"
        ? "Qveris 缓存行情"
        : "行情暂不可用"

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Activity className="size-4" aria-hidden />
            Today · 今日快照
          </div>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">市场指数</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            {sourceLabel}
            <span className="mx-2 text-ink-faint">·</span>
            更新 {CHINA_TIME_LABEL} {updatedAt}
            <span className="mx-2 text-ink-faint">·</span>
            5m TTL
          </p>
        </div>
        <Link
          href="/radar"
          className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] text-white"
        >
          查看雷达 <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {report.fallbackReason && (
        <div className="mb-4 rounded-[7px] border border-rule bg-[#fff7e8] px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {report.fallbackReason}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {report.quotes.map((idx) => (
          <IndexCard key={idx.codeQveris} quote={idx} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule-soft pt-4">
        <span className="font-mono text-[11px] text-ink-muted">说明</span>
        <span className="rounded-[5px] border border-rule bg-white px-2.5 py-1 text-[12px] text-ink-muted">
          首页指数全部来自 Qveris；实时接口超时时展示最近可信缓存，不展示模拟数。
        </span>
      </div>
    </section>
  )
}

export function TodaySnapshotFallback() {
  const report = indexFallbackReport("timeout")
  const updatedAt = formatUpdatedAt(report.fetchedAt)
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Activity className="size-4" aria-hidden />
            Today · 今日快照
          </div>
          <h2 className="mt-2 text-[22px] font-semibold text-ink">市场指数</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            读取缓存
            <span className="mx-2 text-ink-faint">·</span>
            更新 {CHINA_TIME_LABEL} {updatedAt}
          </p>
        </div>
        <Link
          href="/radar"
          className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] text-white"
        >
          查看雷达 <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {INDEX_FALLBACK_QUOTES.map((idx) => (
          <IndexCard key={idx.codeQveris} quote={idx} />
        ))}
      </div>
    </section>
  )
}

function indexFallbackReport(reason: "timeout" | "error", error?: unknown): MarketIndexesResult {
  return {
    quotes: INDEX_FALLBACK_QUOTES,
    fetchedAt: new Date().toISOString(),
    cacheAgeMs: 0,
    ttlMs: 5 * 60_000,
    source: "unavailable",
    fallbackReason: reason === "timeout"
      ? "Qveris 指数行情拉取超过 2.5 秒，首页暂不展示模拟指数。"
      : `Qveris 指数行情调用异常：${error instanceof Error ? error.message : String(error ?? "unknown")}`,
  }
}

function IndexCard({ quote }: { quote: MarketIndexQuote }) {
  const isUp = (quote.changePct ?? 0) >= 0
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-muted">{quote.code}</p>
      <p className="mt-1 truncate text-[13px] text-ink-soft">{quote.name}</p>
      <p className="mt-2 font-mono text-[20px] text-ink tabular">
        {quote.value == null ? "—" : formatIndexValue(quote.value)}
      </p>
      <p className={`mt-1 font-mono text-[12px] tabular ${isUp ? "text-bull" : "text-bear"}`}>
        {quote.changePct == null ? "行情待确认" : `${isUp ? "+" : ""}${quote.changePct.toFixed(2)}%`}
      </p>
      {(quote.tradeDate || quote.tradeTime) && (
        <p className="mt-2 font-mono text-[10px] text-ink-faint">
          {CHINA_TIME_LABEL} {quote.tradeDate ?? ""}
          {quote.tradeTime ? ` ${quote.tradeTime.slice(0, 5)}` : ""}
        </p>
      )}
    </div>
  )
}

function formatIndexValue(value: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatUpdatedAt(iso: string) {
  return formatChinaDateTime(iso, { dateStyle: "short" })
}
