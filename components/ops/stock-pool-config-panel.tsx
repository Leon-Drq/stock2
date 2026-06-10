"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, RefreshCw, RotateCcw, Save, Search, SlidersHorizontal, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Exchange = "SH" | "SZ"

type StockPoolItem = {
  symbol: string
  symbolQveris: string
  name: string
  industry: string
  note?: string
  createdAt?: string
}

type StockPoolFilters = {
  exchanges: Exchange[]
  industries: string[]
  symbolPrefixes: string[]
  requireHistory: boolean
  minBars: number
  maxStaleDays: number | null
}

type StockPoolConfig = {
  targetSize: number
  include: StockPoolItem[]
  excludeSymbols: string[]
  filters: StockPoolFilters
  updatedAt?: string
}

type Candidate = StockPoolItem & {
  included: boolean
  excluded: boolean
  effective: boolean
}

type Payload = {
  config: StockPoolConfig
  candidates: Candidate[]
  availableIndustries: string[]
  baseCount: number
  afterStaticFilters: number
  afterHistoryFilters: number
  manualIncludeCount: number
  excludedCount: number
  targetSize: number
  stocks: StockPoolItem[]
  historyFilterApplied: boolean
  historyFilterAvailable: boolean
  notes: string[]
}

const EMPTY_CONFIG: StockPoolConfig = {
  targetSize: 500,
  include: [],
  excludeSymbols: [],
  filters: {
    exchanges: [],
    industries: [],
    symbolPrefixes: [],
    requireHistory: false,
    minBars: 0,
    maxStaleDays: null,
  },
}

export function StockPoolConfigPanel() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [draft, setDraft] = useState<StockPoolConfig>(EMPTY_CONFIG)
  const [query, setQuery] = useState("")
  const [industryInput, setIndustryInput] = useState("")
  const [prefixInput, setPrefixInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [newStock, setNewStock] = useState({ symbol: "", exchange: "SH" as Exchange, name: "", industry: "" })

  useEffect(() => {
    void loadConfig()
  }, [])

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const rows = payload?.candidates ?? []
    if (!normalized) return rows.slice(0, 80)
    return rows
      .filter((stock) => (
        stock.symbol.includes(normalized) ||
        stock.symbolQveris.toLowerCase().includes(normalized) ||
        stock.name.toLowerCase().includes(normalized) ||
        stock.industry.toLowerCase().includes(normalized)
      ))
      .slice(0, 120)
  }, [payload?.candidates, query])

  async function loadConfig() {
    setLoading(true)
    setMessage("")
    const response = await fetch("/api/stock-pool/config", { cache: "no-store" })
    if (!response.ok) {
      setMessage(await errorMessage(response, "读取股票池配置失败"))
      setLoading(false)
      return
    }
    const next = await response.json() as Payload
    setPayload(next)
    setDraft(next.config)
    setIndustryInput(next.config.filters.industries.join(","))
    setPrefixInput(next.config.filters.symbolPrefixes.join(","))
    setLoading(false)
  }

  async function saveConfig(nextConfig = draft) {
    setSaving(true)
    setMessage("")
    const normalized = normalizeDraft(nextConfig)
    const response = await fetch("/api/stock-pool/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalized),
    })
    if (!response.ok) {
      setMessage(await errorMessage(response, "保存股票池配置失败"))
      setSaving(false)
      return
    }
    const next = await response.json() as Payload
    setPayload(next)
    setDraft(next.config)
    setIndustryInput(next.config.filters.industries.join(","))
    setPrefixInput(next.config.filters.symbolPrefixes.join(","))
    setMessage("配置已保存")
    setSaving(false)
  }

  function patchFilters(patch: Partial<StockPoolFilters>) {
    setDraft((current) => ({
      ...current,
      filters: {
        ...current.filters,
        ...patch,
      },
    }))
  }

  function toggleExchange(exchange: Exchange) {
    const current = new Set(draft.filters.exchanges)
    if (current.has(exchange)) current.delete(exchange)
    else current.add(exchange)
    patchFilters({ exchanges: Array.from(current) })
  }

  function toggleExclude(stock: StockPoolItem) {
    const excluded = new Set(draft.excludeSymbols)
    if (excluded.has(stock.symbol)) excluded.delete(stock.symbol)
    else excluded.add(stock.symbol)
    void saveConfig({ ...draft, excludeSymbols: Array.from(excluded) })
  }

  function removeManualInclude(symbol: string) {
    void saveConfig({
      ...draft,
      include: draft.include.filter((stock) => stock.symbol !== symbol),
    })
  }

  function addManualStock() {
    const symbol = normalizeSymbol(newStock.symbol)
    if (!symbol) {
      setMessage("请输入 6 位股票代码")
      return
    }
    const item: StockPoolItem = {
      symbol,
      symbolQveris: `${symbol}.${newStock.exchange}`,
      name: newStock.name.trim() || symbol,
      industry: newStock.industry.trim() || "待归类",
    }
    const include = [...draft.include.filter((stock) => stock.symbol !== symbol), item]
    const excludeSymbols = draft.excludeSymbols.filter((itemSymbol) => itemSymbol !== symbol)
    void saveConfig({ ...draft, include, excludeSymbols })
    setNewStock({ symbol: "", exchange: "SH", name: "", industry: "" })
  }

  function applyTextFilters() {
    patchFilters({
      industries: splitList(industryInput),
      symbolPrefixes: splitList(prefixInput).map((prefix) => prefix.slice(0, 3)),
    })
  }

  if (loading) {
    return (
      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-10 text-center text-sm text-ink-muted">
        <Loader2 className="mx-auto mb-3 size-5 animate-spin" aria-hidden />
        读取股票池配置...
      </section>
    )
  }

  return (
    <section className="mt-5 grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <SlidersHorizontal className="size-4" aria-hidden />
            Universe Rules
          </div>
          <h2 className="mt-1 text-[20px] font-semibold text-ink">运行时规则</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Kpi label="有效股票" value={String(payload?.stocks.length ?? 0)} />
            <Kpi label="基础候选" value={String(payload?.baseCount ?? 0)} />
            <Kpi label="手工加入" value={String(draft.include.length)} />
            <Kpi label="排除名单" value={String(draft.excludeSymbols.length)} />
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="font-mono text-[10px] uppercase text-ink-faint">目标数量</span>
              <Input
                className="mt-1"
                type="number"
                min={30}
                value={draft.targetSize}
                onChange={(event) => setDraft((current) => ({ ...current, targetSize: Number(event.target.value) }))}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <ToggleButton active={draft.filters.exchanges.includes("SH")} onClick={() => toggleExchange("SH")} label="上交所 SH" />
              <ToggleButton active={draft.filters.exchanges.includes("SZ")} onClick={() => toggleExchange("SZ")} label="深交所 SZ" />
            </div>

            <label className="block">
              <span className="font-mono text-[10px] uppercase text-ink-faint">行业过滤</span>
              <Input
                className="mt-1"
                value={industryInput}
                onChange={(event) => setIndustryInput(event.target.value)}
                onBlur={applyTextFilters}
                placeholder="银行Ⅱ,半导体,电力"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] uppercase text-ink-faint">代码前缀</span>
              <Input
                className="mt-1"
                value={prefixInput}
                onChange={(event) => setPrefixInput(event.target.value)}
                onBlur={applyTextFilters}
                placeholder="600,601,300"
              />
            </label>

            <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">要求已有历史 K 线</span>
                <Switch checked={draft.filters.requireHistory} onCheckedChange={(requireHistory) => patchFilters({ requireHistory })} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="最少 K 线"
                  value={draft.filters.minBars}
                  onChange={(event) => patchFilters({ minBars: Number(event.target.value) })}
                />
                <Input
                  type="number"
                  min={0}
                  placeholder="最大滞后天数"
                  value={draft.filters.maxStaleDays ?? ""}
                  onChange={(event) => patchFilters({ maxStaleDays: event.target.value ? Number(event.target.value) : null })}
                />
              </div>
              {payload?.notes.map((note) => (
                <p key={note} className="mt-2 text-[12px] leading-5 text-[#8a5a16]">{note}</p>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => saveConfig()} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                保存规则
              </Button>
              <Button variant="outline" onClick={loadConfig} disabled={saving}>
                <RefreshCw className="size-4" aria-hidden />
                刷新
              </Button>
            </div>
            {message && <p className="text-sm text-ink-muted">{message}</p>}
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="font-mono text-[11px] text-ink-muted">Manual Include</div>
          <h2 className="mt-1 text-[18px] font-semibold text-ink">手工加入股票</h2>
          <div className="mt-4 grid gap-2">
            <Input value={newStock.symbol} onChange={(event) => setNewStock((current) => ({ ...current, symbol: event.target.value }))} placeholder="股票代码，例如 688365" />
            <div className="grid grid-cols-2 gap-2">
              <ToggleButton active={newStock.exchange === "SH"} onClick={() => setNewStock((current) => ({ ...current, exchange: "SH" }))} label="SH" />
              <ToggleButton active={newStock.exchange === "SZ"} onClick={() => setNewStock((current) => ({ ...current, exchange: "SZ" }))} label="SZ" />
            </div>
            <Input value={newStock.name} onChange={(event) => setNewStock((current) => ({ ...current, name: event.target.value }))} placeholder="名称" />
            <Input value={newStock.industry} onChange={(event) => setNewStock((current) => ({ ...current, industry: event.target.value }))} placeholder="行业" />
            <Button onClick={addManualStock} disabled={saving}>
              <Plus className="size-4" aria-hidden />
              加入股票池
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-[7px] border border-rule bg-white">
        <div className="flex flex-col gap-3 border-b border-rule px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Search className="size-4" aria-hidden />
              Candidates
            </div>
            <h2 className="mt-1 text-[20px] font-semibold text-ink">股票查询与增减</h2>
          </div>
          <Input className="max-w-[360px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码、名称、行业" />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4 md:px-5">股票</TableHead>
              <TableHead>行业</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="pr-4 text-right md:pr-5">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCandidates.map((stock) => (
              <TableRow key={stock.symbol}>
                <TableCell className="px-4 md:px-5">
                  <div className="font-medium text-ink">{stock.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-ink-muted">{stock.symbolQveris}</div>
                </TableCell>
                <TableCell>{stock.industry}</TableCell>
                <TableCell>{stock.included ? <Badge variant="outline">手工</Badge> : <Badge variant="outline">基础池</Badge>}</TableCell>
                <TableCell>{stock.effective ? <Badge className="bg-health-ok text-white">有效</Badge> : <Badge variant="outline">未生效</Badge>}</TableCell>
                <TableCell className="pr-4 text-right md:pr-5">
                  <div className="flex justify-end gap-2">
                    {stock.included && (
                      <Button variant="outline" size="sm" onClick={() => removeManualInclude(stock.symbol)} disabled={saving}>
                        <Trash2 className="size-4" aria-hidden />
                        移除
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => toggleExclude(stock)} disabled={saving}>
                      {stock.excluded ? <RotateCcw className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                      {stock.excluded ? "恢复" : "排除"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule-soft bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-[16px] text-ink">{value}</p>
    </div>
  )
}

function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-[7px] border px-3 text-sm ${active ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink-muted hover:text-ink"}`}
    >
      {label}
    </button>
  )
}

function normalizeDraft(config: StockPoolConfig): StockPoolConfig {
  return {
    ...config,
    filters: {
      ...config.filters,
      industries: splitList(config.filters.industries.join(",")),
      symbolPrefixes: splitList(config.filters.symbolPrefixes.join(",")).map((prefix) => prefix.slice(0, 3)),
    },
  }
}

function splitList(value: string) {
  return Array.from(new Set(value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean)))
}

function normalizeSymbol(value: string) {
  return value.match(/[0368]\d{5}/)?.[0] ?? ""
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: string; detail?: string }
    return payload.error ?? payload.detail ?? fallback
  } catch {
    return fallback
  }
}
