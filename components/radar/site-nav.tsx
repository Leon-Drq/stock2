"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  Database,
  FlaskConical,
  Gauge,
  History,
  LineChart,
  Menu,
  Radar,
  Radio,
  Search,
  Settings2,
  Sparkles,
  TestTube2,
  WalletCards,
  Zap,
} from "lucide-react"

const NAV_ITEMS = [
  { href: "/", label: "今日精选", tag: "HOME", icon: Gauge },
  { href: "/data", label: "数据源目录", tag: "L0", icon: Database },
  { href: "/factors", label: "因子库", tag: "L1", icon: Activity },
  { href: "/factor-lab", label: "因子实验台", tag: "LAB", icon: TestTube2 },
  { href: "/strategy-research", label: "策略研究", tag: "LAB", icon: ClipboardList },
  { href: "/backtest", label: "真实回测", tag: "BT", icon: LineChart },
  { href: "/strategies", label: "正式目录", tag: "L2", icon: FlaskConical },
  { href: "/radar", label: "策略雷达", tag: "L3", icon: Radar },
  { href: "/radar/history", label: "信号账本", tag: "LOG", icon: History },
  { href: "/assistant", label: "自然语言研究", tag: "L4", icon: Bot },
  { href: "/market", label: "社区市场", tag: "BETA", icon: BarChart3 },
  { href: "/simulation", label: "实盘模拟", tag: "L5", icon: WalletCards },
  { href: "/ops", label: "运行中枢", tag: "OPS", icon: Radio },
  { href: "/ops/cron", label: "定时任务调度", tag: "JOB", icon: CalendarClock },
  { href: "/discover", label: "Qveris 能力探针", tag: "Q", icon: Sparkles },
  { href: "/ops/model", label: "模型配置", tag: "AI", icon: Settings2 },
  { href: "/strategy-research/miner/settings", label: "策略矿工配置", tag: "MINER", icon: Settings2 },
]

const NAV_SECTIONS = [
  {
    label: "工作台",
    eyebrow: "HOME",
    items: [NAV_ITEMS[0]],
  },
  {
    label: "L0 数据层",
    eyebrow: "DATA",
    items: [NAV_ITEMS[1], NAV_ITEMS[14]],
  },
  {
    label: "L1 因子层",
    eyebrow: "FACTOR",
    items: [NAV_ITEMS[2], NAV_ITEMS[3]],
  },
  {
    label: "L2 策略流水线",
    eyebrow: "STRATEGY",
    items: [NAV_ITEMS[4], NAV_ITEMS[16], NAV_ITEMS[5], NAV_ITEMS[6]],
  },
  {
    label: "L3 雷达层",
    eyebrow: "RADAR",
    items: [NAV_ITEMS[7], NAV_ITEMS[8]],
  },
  {
    label: "L4 智能与市场",
    eyebrow: "AI / MARKET",
    items: [NAV_ITEMS[9], NAV_ITEMS[15], NAV_ITEMS[10]],
  },
  {
    label: "L5 模拟执行",
    eyebrow: "PAPER",
    items: [NAV_ITEMS[11], NAV_ITEMS[12], NAV_ITEMS[13]],
  },
]

export function SiteNav() {
  const pathname = usePathname()
  const [pendingTarget, setPendingTarget] = useState<{ href: string; fromPath: string } | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const activeItem = NAV_ITEMS.find((item) => isActive(pathname, item.href)) ?? NAV_ITEMS[0]
  const ActiveIcon = activeItem.icon

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] border-r border-rule bg-[#f5f5f4] lg:block">
        <div className="flex h-full flex-col">
          <Link href="/" className="flex h-14 items-center gap-3 border-b border-rule px-4">
            <span className="grid size-8 place-items-center rounded-[7px] bg-ink text-white">
              <Search className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight text-ink">Qveris</span>
              <span className="block font-mono text-[10px] leading-tight text-ink-muted">stock intelligence</span>
            </span>
          </Link>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            {NAV_SECTIONS.map((section) => (
              <NavSection key={section.label} label={section.label} eyebrow={section.eyebrow}>
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(pathname, item.href)}
                    pending={pendingTarget?.href === item.href && pendingTarget.fromPath === pathname}
                    onNavigate={() => {
                      if (!isActive(pathname, item.href)) setPendingTarget({ href: item.href, fromPath: pathname })
                    }}
                  />
                ))}
              </NavSection>
            ))}
          </div>

          <div className="border-t border-rule p-3">
            <div className="rounded-[7px] border border-rule bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-ink-muted">当前架构</span>
                <span className="size-2 rounded-full bg-health-ok shadow-[0_0_0_3px_rgba(79,122,90,0.12)]" aria-hidden />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["L0-L5", "Qveris", "模拟盘"].map((tag) => (
                  <span key={tag} className="rounded-[5px] border border-rule-soft bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <nav className="sticky top-0 z-40 border-b border-rule bg-white/95 shadow-sm shadow-black/[0.02] backdrop-blur lg:hidden">
        <div className="flex h-12 items-center justify-between px-3 sm:h-14 sm:px-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="grid size-8 place-items-center rounded-[7px] bg-ink text-white">
              <Search className="size-4" aria-hidden />
            </span>
            Qveris
          </Link>
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-ink-muted" aria-hidden />
            <Zap className="size-4 text-ink-muted" aria-hidden />
          </div>
        </div>
        <div className="border-t border-rule-soft px-3 py-2">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex h-10 w-full items-center justify-between rounded-[8px] border border-rule bg-[#f5f5f4] px-3 text-left text-[13px] text-ink"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-site-menu"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid size-6 place-items-center rounded-[6px] bg-white text-ink">
                <ActiveIcon className="size-3.5" aria-hidden />
              </span>
              <span className="truncate font-medium">{activeItem.label}</span>
              <span className="rounded-[5px] bg-[#dff0f9] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-[#17729a]">
                {activeItem.tag}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
              菜单 <ChevronDown className="size-3.5" aria-hidden />
            </span>
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-ink/20 p-2 backdrop-blur-[2px] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="关闭菜单"
          />
          <section
            id="mobile-site-menu"
            role="dialog"
            aria-modal="true"
            aria-label="站点菜单"
            className="relative flex max-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-[12px] border border-rule bg-white shadow-2xl"
          >
            <header className="flex h-14 items-center justify-between border-b border-rule px-4">
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 text-sm font-semibold text-ink"
              >
                <span className="grid size-8 place-items-center rounded-[7px] bg-ink text-white">
                  <Search className="size-4" aria-hidden />
                </span>
                Qveris
              </Link>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink-muted"
              >
                <Menu className="size-3.5" aria-hidden />
                关闭
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              {NAV_SECTIONS.map((section) => (
                <MobileNavSection key={section.label} label={section.label} eyebrow={section.eyebrow}>
                  {section.items.map((item) => (
                    <MobileNavLink
                      key={item.href}
                      item={item}
                      active={isActive(pathname, item.href)}
                      pending={pendingTarget?.href === item.href && pendingTarget.fromPath === pathname}
                      onNavigate={() => {
                        setMobileMenuOpen(false)
                        if (!isActive(pathname, item.href)) setPendingTarget({ href: item.href, fromPath: pathname })
                      }}
                    />
                  ))}
                </MobileNavSection>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function NavSection({
  label,
  eyebrow,
  children,
}: {
  label: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline gap-1 px-1">
        <span className="text-[11px] font-semibold text-ink">{label}</span>
        {eyebrow && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">{eyebrow}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function NavLink({
  item,
  active,
  pending,
  onNavigate,
}: {
  item: { href: string; label: string; tag: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
  active: boolean
  pending: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-busy={pending}
      className={`flex h-9 items-center justify-between rounded-[7px] px-3 py-2 text-[13px] transition-colors ${
        active
          ? "bg-white text-ink shadow-[inset_0_0_0_1px_var(--rule)]"
          : pending
            ? "bg-white/80 text-ink"
            : "text-ink-muted hover:bg-white/70 hover:text-ink"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
      </span>
      {item.tag && (
        <span className="rounded-[5px] bg-[#dff0f9] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-[#17729a]">
          {pending ? "..." : item.tag}
        </span>
      )}
    </Link>
  )
}

function MobileNavSection({
  label,
  eyebrow,
  children,
}: {
  label: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-baseline gap-1 px-1">
        <span className="text-[12px] font-semibold text-ink">{label}</span>
        {eyebrow && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">{eyebrow}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  )
}

function MobileNavLink({
  item,
  active,
  pending,
  onNavigate,
}: {
  item: { href: string; label: string; tag: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
  active: boolean
  pending: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-busy={pending}
      className={`flex min-h-12 items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-[13px] transition-colors ${
        active ? "border-ink bg-ink text-white" : "border-rule bg-[#f7f7f6] text-ink-soft"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
      </span>
      <span
        className={`rounded-[5px] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em] ${
          active ? "bg-white/15 text-white" : "bg-[#dff0f9] text-[#17729a]"
        }`}
      >
        {pending ? "..." : item.tag}
      </span>
    </Link>
  )
}

function isActive(pathname: string, href: string) {
  if (href === "/radar") return pathname === href
  if (href === "/ops") return pathname === href
  if (href === "/strategy-research") return pathname === href
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"))
}
