type ConclusionProps = {
  text: string
}

export function Conclusion({ text }: ConclusionProps) {
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <SectionLabel>盘前摘要</SectionLabel>
      <blockquote className="mt-3">
        <p className="text-[15px] leading-7 text-ink md:text-[16px]">
          {text}
        </p>
      </blockquote>
    </section>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-1.5 rounded-full bg-ink" aria-hidden />
      <span className="font-mono text-[11px] text-ink-muted">{children}</span>
    </div>
  )
}
