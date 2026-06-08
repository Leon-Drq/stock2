/**
 * 买点判定引擎 — 由技术指标数字推出 buyPoint 类型 + 一句**带数字**的理由。
 *
 * 与之前「按 topFactor 贴模板」不同：
 *   - buyPoint 必须有真实事件支撑（突破最高价、价格触 EMA60、RSI 超跌…）
 *   - reason 必须引用具体数字（"收盘 5.94，距 EMA60 5.87 仅 +1.2%"）
 *   - 找不到匹配事件时，buyPoint 退化为最高分因子，reason 也会注明
 *     「无技术触发事件，仅因子排名驱动」，避免误导。
 *
 * 输出与 topFactor 解耦，是 reason 这一栏的可信度核心。
 */

import type { BuyPoint } from "@/lib/radar-data"
import type { TechSnapshot } from "@/lib/technicals"

export type BuyPointVerdict = {
  buyPoint: BuyPoint
  /** 一句话理由，必须含数字；若降级会注明 */
  reason: string
  /** 触发事件等级 0–1，用于综合分加权 */
  eventStrength: number
  /** 哪类事件命中：用于排查 */
  matched:
    | "breakout"
    | "platform-break"
    | "ema-touch"
    | "boll-mid-touch"
    | "oversold-reversion"
    | "factor-only"
}

/** 简单 fmt：浮点保留 2 位 */
function f(n: number, d = 2): string {
  return n.toFixed(d)
}

/** 百分比差 %：(a − b) / b * 100 */
function pctDiff(a: number, b: number): number {
  if (!b) return 0
  return ((a - b) / b) * 100
}

/**
 * 主判定函数。
 * 输入：技术快照 + 最高分因子名（用于降级文案）。
 * 输出：buyPoint + reason。
 */
export function judgeBuyPoint(
  tech: TechSnapshot,
  topFactorLabel: string,
  topPercentile: number,
): BuyPointVerdict {
  const { close, ema20, ema60, ema60Rising, boll, rsi14, platform, volRatio, hh20 } = tech

  // ─── 优先级 1: 平台突破（最强信号） ───
  // 条件：今日收盘 > 平台高点 + 0.3%；平台持续 ≥ 5 天；量比 ≥ 1.3 即量价共振
  if (platform && close > platform.high * 1.003) {
    const volNote =
      volRatio != null && volRatio >= 1.3
        ? `，量比 ${f(volRatio, 1)}× 量价共振`
        : volRatio != null
        ? `，量比 ${f(volRatio, 1)}×`
        : ""
    return {
      buyPoint: "platform-break",
      reason: `突破 ${platform.days} 日窄幅平台（${f(platform.low)}–${f(
        platform.high,
      )}，振幅 ${f(platform.amplitudePct, 1)}%），收盘 ${f(close)}${volNote}`,
      eventStrength: 0.95,
      matched: "platform-break",
    }
  }

  // ─── 优先级 2: 创新高/突破 20 日高点 ───
  if (hh20 != null && close > hh20 * 1.003) {
    const breakPct = pctDiff(close, hh20)
    const volNote =
      volRatio != null && volRatio >= 1.5
        ? `，放量 ${f(volRatio, 1)}× 确认`
        : volRatio != null
        ? `，量比 ${f(volRatio, 1)}×`
        : ""
    return {
      buyPoint: "breakout-confirm",
      reason: `突破 20 日新高 ${f(hh20)}（+${f(breakPct, 1)}%），收盘 ${f(close)}${volNote}`,
      eventStrength: 0.9,
      matched: "breakout",
    }
  }

  // ─── 优先级 3: 回踩 EMA60（趋势线支撑） ───
  // 条件：|close − EMA60| / close ≤ 2.5%，且 EMA60 上行
  if (ema60 != null && Math.abs(close - ema60) / close <= 0.025 && ema60Rising === true) {
    const dist = pctDiff(close, ema60)
    const ema20Note =
      ema20 != null ? `，EMA20 ${f(ema20)}` : ""
    return {
      buyPoint: "ema-touch",
      reason: `收盘 ${f(close)} 回踩 EMA60 ${f(ema60)}（${
        dist >= 0 ? "+" : ""
      }${f(dist, 1)}%）${ema20Note}，EMA60 上行`,
      eventStrength: 0.8,
      matched: "ema-touch",
    }
  }

  // ─── 优先级 4: 触及/逼近布林中轨（短线回调到位） ───
  if (
    boll != null &&
    Math.abs(close - boll.middle) / close <= 0.015 &&
    close >= boll.middle * 0.985 // 不允许严重跌破，避免抄飞刀
  ) {
    const dist = pctDiff(close, boll.middle)
    return {
      buyPoint: "pullback",
      reason: `收盘 ${f(close)} 贴 BOLL(20,2) 中轨 ${f(boll.middle)}（${
        dist >= 0 ? "+" : ""
      }${f(dist, 1)}%），上轨 ${f(boll.upper)} / 下轨 ${f(boll.lower)}`,
      eventStrength: 0.7,
      matched: "boll-mid-touch",
    }
  }

  // ─── 优先级 5: 超跌 + 短期反转（左侧试仓） ───
  if (rsi14 != null && rsi14 < 32) {
    const ema20Note = ema20 != null ? `，EMA20 ${f(ema20)}` : ""
    return {
      buyPoint: "left-side",
      reason: `RSI14 ${f(rsi14, 0)}（< 32 超跌区）${ema20Note}，左侧试仓等待企稳`,
      eventStrength: 0.65,
      matched: "oversold-reversion",
    }
  }

  // ─── 降级: 无明确技术事件，仅因子排名驱动 ───
  // 这里必须诚实：reason 不再说 "趋势头部/量价共振"，而是说明只是排名。
  const rangeNote =
    ema60 != null && ema20 != null
      ? `（收盘 ${f(close)} / EMA20 ${f(ema20)} / EMA60 ${f(ema60)}）`
      : ""
  return {
    buyPoint: "left-side",
    reason: `${topFactorLabel}分位 ${(topPercentile * 100).toFixed(0)}%${rangeNote}，无技术触发事件，仅因子排名驱动`,
    eventStrength: 0.35,
    matched: "factor-only",
  }
}
