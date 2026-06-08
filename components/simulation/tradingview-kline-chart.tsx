"use client"

import { useEffect, useMemo, useRef } from "react"
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts"
import type { PaperTradeChart } from "@/lib/paper-trading"

const UP_COLOR = "#2f7a53"
const DOWN_COLOR = "#c43d32"
const MUTED_COLOR = "#6f7f8d"
const BG_COLOR = "#f6f9fb"
const GRID_COLOR = "#dfe7ee"

export function TradingViewKLineChart({ chart }: { chart: PaperTradeChart }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const candleData = useMemo<CandlestickData<Time>[]>(
    () =>
      chart.bars.map((bar) => ({
        time: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    [chart.bars],
  )

  const volumeData = useMemo<HistogramData<Time>[]>(
    () =>
      chart.bars.map((bar) => ({
        time: bar.date,
        value: bar.volume,
        color: bar.synthetic
          ? "rgba(111, 127, 141, 0.14)"
          : bar.close >= bar.open
            ? "rgba(47, 122, 83, 0.18)"
            : "rgba(196, 61, 50, 0.16)",
      })),
    [chart.bars],
  )

  const tradeMarkers = useMemo<SeriesMarker<Time>[]>(
    () =>
      chart.markers
        .map((marker) => {
          const buy = marker.side === "buy"
          const filled = marker.status === "filled"
          const color = !filled ? MUTED_COLOR : buy ? "#177245" : "#bd2f24"
          const statusText = marker.status === "filled" ? "成交" : marker.status === "rejected" ? "拒" : "跳"
          return {
            id: marker.id,
            time: marker.date,
            position: "atPriceMiddle" as const,
            price: marker.price,
            shape: buy ? ("arrowUp" as const) : ("arrowDown" as const),
            color,
            size: filled ? 1.05 : 0.85,
            text: `${buy ? "B" : "S"} ${statusText}`,
          }
        })
        .sort((a, b) => String(a.time).localeCompare(String(b.time))),
    [chart.markers],
  )

  const latestBar = chart.bars.at(-1)
  const previousBar = chart.bars.at(-2)
  const latestChangePct = latestBar && previousBar && previousBar.close > 0
    ? ((latestBar.close - previousBar.close) / previousBar.close) * 100
    : undefined

  useEffect(() => {
    const container = containerRef.current
    if (!container || candleData.length === 0) return

    const chartApi = createChart(container, {
      autoSize: true,
      height: container.clientHeight || 420,
      layout: {
        background: { type: ColorType.Solid, color: BG_COLOR },
        textColor: "#68717c",
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
      },
      localization: {
        locale: "zh-CN",
        priceFormatter: (price: number) => price.toFixed(2),
      },
      rightPriceScale: {
        borderColor: GRID_COLOR,
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: GRID_COLOR,
        rightOffset: 8,
        barSpacing: 8,
        fixLeftEdge: true,
        timeVisible: false,
      },
      grid: {
        vertLines: { color: "rgba(223, 231, 238, 0.55)", style: LineStyle.Solid },
        horzLines: { color: GRID_COLOR, style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(30, 90, 145, 0.32)", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "rgba(30, 90, 145, 0.28)", width: 1, style: LineStyle.Dashed },
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    })

    const candleSeries = chartApi.addSeries(CandlestickSeries, {
      upColor: "rgba(47, 122, 83, 0.12)",
      downColor: "rgba(196, 61, 50, 0.12)",
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      lastValueVisible: true,
      priceLineVisible: false,
    })
    candleSeries.setData(candleData)

    const volumeSeries = chartApi.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    })
    volumeSeries.setData(volumeData)
    chartApi.priceScale("volume").applyOptions({
      borderVisible: false,
      scaleMargins: { top: 0.78, bottom: 0 },
    })

    const markerApi = createSeriesMarkers(candleSeries, tradeMarkers, {
      autoScale: true,
      zOrder: "top",
    })

    chartApi.timeScale().fitContent()
    if (candleData.length > 90) {
      chartApi.timeScale().setVisibleLogicalRange({
        from: candleData.length - 90,
        to: candleData.length + 8,
      })
    }

    return () => {
      markerApi.detach()
      chartApi.remove()
    }
  }, [candleData, tradeMarkers, volumeData])

  if (chart.bars.length === 0) {
    return (
      <div className="grid min-h-[280px] place-items-center rounded-[12px] border border-rule bg-[#fafafa] px-4 text-center text-sm text-ink-muted sm:min-h-[360px]">
        {chart.name} 暂无可用 K 线缓存；数据层补齐后会自动叠加买卖点。
      </div>
    )
  }

  return (
    <div className="min-w-0 rounded-[12px] border border-rule bg-[#f6f9fb] p-3">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold text-ink">{chart.name}</p>
            <span className="rounded-[6px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
              {chart.symbol}
            </span>
            <span className="rounded-[6px] border border-[#d9e7f5] bg-white px-2 py-1 font-mono text-[10px] text-[#1e5a91]">
              TradingView lightweight
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            日 K · {chart.bars.length} 根 · {chart.markers.length} 个交易标记
          </p>
        </div>
        {latestBar && (
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <span className="rounded-[7px] border border-rule bg-white px-3 py-2 text-ink">
              K线 {latestBar.date} · ¥{latestBar.close.toFixed(2)}
            </span>
            {typeof latestChangePct === "number" && (
              <span className={`rounded-[7px] border border-rule bg-white px-3 py-2 ${latestChangePct >= 0 ? "text-bull" : "text-bear"}`}>
                日涨跌 {formatSignedPercent(latestChangePct)}
              </span>
            )}
            {typeof chart.currentPrice === "number" && chart.latestDate !== latestBar.date && (
              <span className="rounded-[7px] border border-rule bg-white px-3 py-2 text-ink">
                现价 ¥{chart.currentPrice.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        aria-label={`${chart.name} TradingView K 线交易标记`}
        className="h-[340px] min-w-0 overflow-hidden rounded-[10px] bg-[#f6f9fb] sm:h-[420px] lg:h-[480px]"
      />
      <div className="mt-3 flex flex-wrap gap-3 px-1 font-mono text-[11px] text-ink-muted">
        <span><span className="mr-1 inline-block size-2 bg-[#177245]" />买入成交</span>
        <span><span className="mr-1 inline-block size-2 bg-[#bd2f24]" />卖出成交</span>
        <span><span className="mr-1 inline-block size-2 bg-[#6f7f8d]" />跳过/拒单</span>
        <span>支持十字光标、拖拽、滚轮缩放和触控缩放</span>
      </div>
    </div>
  )
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}
