import { Bot, CheckCircle2, KeyRound, ServerCog } from "lucide-react"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { getDefaultModelRuntime, PROVIDER_DEFAULTS } from "@/lib/model-providers"

export const metadata = {
  title: "模型配置 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default function ModelOpsPage() {
  const runtime = getDefaultModelRuntime()
  const supported = Object.entries(PROVIDER_DEFAULTS)

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Ops"
        layerEn="Model Runtime"
        title="模型配置"
        subtitle="集中查看后台服务当前使用的默认模型。这里不会显示真实 API Key，只显示是否已配置，以及各模型页面会读取到的安全运行配置。"
      />

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Bot className="size-4" aria-hidden />
              default model
            </div>
            <h2 className="mt-2 text-[22px] font-semibold text-ink">{runtime.provider} / {runtime.model}</h2>
            <p className="mt-2 max-w-[820px] text-[13px] leading-6 text-ink-muted">
              因子实验台、自然语言研究、策略实验室和个股诊断都会默认使用这组配置。页面允许临时覆盖，但不会保存用户输入的 API Key。
            </p>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-[7px] border px-3 py-2 font-mono text-[11px] ${
            runtime.keyConfigured ? "border-[#b9dfc2] bg-[#eef8f0] text-health-ok" : "border-[#ead8b7] bg-[#fff8ed] text-[#8a5a16]"
          }`}>
            <CheckCircle2 className="size-4" aria-hidden />
            {runtime.keyConfigured ? "密钥已配置" : "缺少模型密钥"}
          </span>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <ModelCell icon={ServerCog} label="提供商" value={runtime.provider} />
          <ModelCell icon={Bot} label="模型名称" value={runtime.model} />
          <ModelCell icon={KeyRound} label="密钥来源" value={runtime.keyHint} />
        </div>
        <div className="mt-2 rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2 font-mono text-[10px] text-ink-faint">
          Base URL: {maskUrl(runtime.baseUrl)}
        </div>
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">supported providers</p>
            <h2 className="mt-1 text-[20px] font-semibold text-ink">支持的默认模型</h2>
          </div>
          <p className="max-w-[560px] text-[12px] leading-5 text-ink-muted md:text-right">
            推荐使用 `MODEL_PROVIDER_KEY` 统一放置模型密钥，并通过 `DEFAULT_MODEL_PROVIDER`、`DEFAULT_MODEL_NAME` 指定默认模型。
          </p>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {supported.map(([provider, preset]) => (
            <div key={provider} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <p className="text-[14px] font-semibold text-ink">{provider}</p>
              <p className="mt-2 font-mono text-[11px] text-ink-muted">{preset.model}</p>
              <p className="mt-2 truncate font-mono text-[10px] text-ink-faint">{preset.baseUrl}</p>
              <p className="mt-2 rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                {preset.envKey}
              </p>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  )
}

function ModelCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot
  label: string
  value: string
}) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
      <div className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-2 truncate text-[14px] font-semibold text-ink">{value || "未配置"}</p>
    </div>
  )
}

function maskUrl(value: string) {
  if (!value) return "未配置"
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return value.slice(0, 64)
  }
}
