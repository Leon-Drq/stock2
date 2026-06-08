export function Colophon() {
  return (
    <footer className="pb-20 pt-5">
      <div className="rounded-[7px] border border-rule bg-white px-4 py-4 text-sm text-ink-muted md:px-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[46ch] space-y-2">
            <p className="font-mono text-[11px] text-ink">
              说明
            </p>
            <p className="leading-relaxed">
              本报告由量化雷达自动生成，仅作研究参考，不构成投资建议。市场有风险，决策需独立判断。
            </p>
          </div>
          <div className="space-y-1 text-xs">
            <p className="font-mono">
              <span className="text-ink-faint">数据 · </span>
              <span className="text-ink-soft">Qveris.ai</span>
            </p>
            <p className="font-mono">
              <span className="text-ink-faint">引擎 · </span>
              <span className="text-ink-soft">Radar v0.1</span>
            </p>
            <p className="font-mono text-ink-faint">© 2026 · Stock Radar</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
