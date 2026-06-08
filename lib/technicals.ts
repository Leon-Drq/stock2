/**
 * 技术指标计算 — 全部基于 Bar[]（close/high/low/volume），无依赖。
 *
 * 设计原则：
 *   1. 只用真实 K 线数字，输出都是数值，绝不夹带文案。
 *   2. 每个函数返回最新一根 K 线对应的指标值（或 null 如果数据不够）。
 *   3. 用于上层 buy-point-engine 做事件判定，让 reason 句子有数字支撑。
 */

import type { Bar } from "@/lib/qveris-data"

// ─────────────────────────────────────────────────────────────
// 简单 / 指数移动平均
// ─────────────────────────────────────────────────────────────

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

/** EMA(period)。用经典 SMA seed + α = 2/(N+1) 平滑。 */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null
  const alpha = 2 / (period + 1)
  // seed = 前 period 的简单均值
  let e = 0
  for (let i = 0; i < period; i++) e += values[i]
  e /= period
  for (let i = period; i < values.length; i++) {
    e = values[i] * alpha + e * (1 - alpha)
  }
  return e
}

/** EMA 序列（用于判斜率） */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return []
  const out: number[] = []
  const alpha = 2 / (period + 1)
  let e = 0
  for (let i = 0; i < period; i++) e += values[i]
  e /= period
  out.push(e)
  for (let i = period; i < values.length; i++) {
    e = values[i] * alpha + e * (1 - alpha)
    out.push(e)
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Bollinger Bands (period=20, k=2)
// ─────────────────────────────────────────────────────────────

export type Bollinger = {
  /** 中轨 = SMA20 */
  middle: number
  /** 上轨 = middle + k * std */
  upper: number
  /** 下轨 = middle − k * std */
  lower: number
  /** 标准差，便于上层判带宽 */
  std: number
}

export function bollinger(closes: number[], period = 20, k = 2): Bollinger | null {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  const mean = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
  const std = Math.sqrt(variance)
  return {
    middle: mean,
    upper: mean + k * std,
    lower: mean - k * std,
    std,
  }
}

// ─────────────────────────────────────────────────────────────
// RSI(14)
// ─────────────────────────────────────────────────────────────

/** RSI(14)，Wilder 平滑 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gain = 0
  let loss = 0
  // 先用前 period 根 K 线得到初始均值
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  // Wilder 平滑剩余的
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const g = diff > 0 ? diff : 0
    const l = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// ─────────────────────────────────────────────────────────────
// 平台震荡区间识别
// ─────────────────────────────────────────────────────────────

export type Platform = {
  /** 平台已持续的交易日数 */
  days: number
  /** 平台中枢价 = lookback 期内 close 中位数 */
  pivot: number
  /** 平台高点 / 低点 */
  high: number
  low: number
  /** 振幅 % = (high-low)/pivot */
  amplitudePct: number
}

/**
 * 简单平台识别：往前推最多 maxDays 天，若 close 的 (high-low)/pivot ≤ amplitudeThreshold
 * 则认为构成平台，返回这一段的 stats；否则返回 null。
 *
 * 默认振幅阈值 8% — A 股个股 5–7 个交易日维持 ≤8% 区间已可归为「窄幅平台」。
 */
export function detectPlatform(
  bars: Bar[],
  opts: { minDays?: number; maxDays?: number; amplitudeThreshold?: number } = {},
): Platform | null {
  const minDays = opts.minDays ?? 5
  const maxDays = opts.maxDays ?? 20
  const amplitudeThreshold = opts.amplitudeThreshold ?? 0.08
  if (bars.length < minDays) return null

  // 从最大窗口往小试，找出最长仍满足阈值的窗口
  for (let win = Math.min(maxDays, bars.length); win >= minDays; win--) {
    const slice = bars.slice(-win)
    const highs = slice.map((b) => b.high)
    const lows = slice.map((b) => b.low)
    const closes = slice.map((b) => b.close).sort((a, b) => a - b)
    const high = Math.max(...highs)
    const low = Math.min(...lows)
    const pivot = closes[Math.floor(closes.length / 2)]
    const amp = (high - low) / pivot
    if (amp <= amplitudeThreshold) {
      return {
        days: win,
        pivot,
        high,
        low,
        amplitudePct: amp * 100,
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// 量比 = 当日 volume / 过去 N 日均量
// ─────────────────────────────────────────────────────────────

export function volumeRatio(bars: Bar[], lookback = 20): number | null {
  if (bars.length < lookback + 1) return null
  const recent = bars.slice(-lookback - 1, -1)
  const avg = recent.reduce((s, b) => s + b.volume, 0) / lookback
  if (avg <= 0) return null
  return bars[bars.length - 1].volume / avg
}

// ─────────────────────────────────────────────────────────────
// 最近 N 日最高价（用于突破识别）
// ─────────────────────────────────────────────────────────────

export function highestHigh(bars: Bar[], lookback: number): number | null {
  if (bars.length < lookback) return null
  return Math.max(...bars.slice(-lookback).map((b) => b.high))
}

// ─────────────────────────────────────────────────────────────
// 一站式：算出一只股最新一根 K 线的全套指标快照
// ─────────────────────────────────────────────────────────────

export type TechSnapshot = {
  close: number
  ema20: number | null
  ema60: number | null
  /** EMA60 相对 5 日前是否上行 */
  ema60Rising: boolean | null
  boll: Bollinger | null
  rsi14: number | null
  platform: Platform | null
  /** 当日量比（vs 20 日均量） */
  volRatio: number | null
  /** 最近 20 日最高价 */
  hh20: number | null
}

export function computeTechSnapshot(bars: Bar[]): TechSnapshot | null {
  if (bars.length < 30) return null
  const closes = bars.map((b) => b.close)
  const ema60Arr = emaSeries(closes, 60)
  const ema60Last = ema60Arr.length ? ema60Arr[ema60Arr.length - 1] : null
  const ema60Prev = ema60Arr.length >= 6 ? ema60Arr[ema60Arr.length - 6] : null
  return {
    close: closes[closes.length - 1],
    ema20: ema(closes, 20),
    ema60: ema60Last,
    ema60Rising:
      ema60Last != null && ema60Prev != null ? ema60Last > ema60Prev : null,
    boll: bollinger(closes, 20, 2),
    rsi14: rsi(closes, 14),
    platform: detectPlatform(bars),
    volRatio: volumeRatio(bars, 20),
    hh20: highestHigh(bars.slice(0, -1), 20), // 最近 20 日（不含今天）的最高
  }
}
