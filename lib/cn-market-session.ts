export type ChinaMarketPhase = "pre-open" | "morning" | "lunch" | "afternoon" | "post-close" | "closed"

export type ChinaMarketSession = {
  now: string
  timeZone: "Asia/Shanghai"
  tradeDate: string
  weekday: number
  minutesOfDay: number
  phase: ChinaMarketPhase
  phaseLabel: string
  isTradingDay: boolean
  isOpen: boolean
  isClosingWindow: boolean
  allowsNewSignals: boolean
  allowsPriceTracking: boolean
  radarRefreshMs: number
  quoteRefreshMs: number
  nextActionAt?: string
  note: string
}

const TIME_ZONE = "Asia/Shanghai" as const
const MINUTE = 60_000
const MORNING_OPEN = 9 * 60 + 30
const MORNING_CLOSE = 11 * 60 + 30
const AFTERNOON_OPEN = 13 * 60
const AFTERNOON_CLOSE = 15 * 60
const CLOSING_PLAN_START = 14 * 60 + 30
const POST_CLOSE_TRACK_UNTIL = 15 * 60 + 20
const DAILY_BAR_READY_AFTER = 18 * 60

export function getChinaMarketSession(now = new Date()): ChinaMarketSession {
  const parts = chinaDateParts(now)
  const minutes = parts.hour * 60 + parts.minute
  const isTradingDay = parts.weekday >= 1 && parts.weekday <= 5

  let phase: ChinaMarketPhase = "closed"
  if (isTradingDay) {
    if (minutes < MORNING_OPEN) phase = "pre-open"
    else if (minutes < MORNING_CLOSE) phase = "morning"
    else if (minutes < AFTERNOON_OPEN) phase = "lunch"
    else if (minutes < AFTERNOON_CLOSE) phase = "afternoon"
    else if (minutes < POST_CLOSE_TRACK_UNTIL) phase = "post-close"
    else phase = "closed"
  }

  const isOpen = phase === "morning" || phase === "afternoon"
  const isClosingWindow = phase === "afternoon" && minutes >= CLOSING_PLAN_START
  const allowsNewSignals = isOpen
  const allowsPriceTracking = isOpen || phase === "post-close"
  const radarRefreshMs = isOpen ? 5 * MINUTE : phase === "lunch" ? 15 * MINUTE : 60 * MINUTE
  const quoteRefreshMs = isOpen ? 2 * MINUTE : phase === "post-close" ? 5 * MINUTE : 0

  return {
    now: now.toISOString(),
    timeZone: TIME_ZONE,
    tradeDate: parts.date,
    weekday: parts.weekday,
    minutesOfDay: minutes,
    phase,
    phaseLabel: phaseLabel(phase, isTradingDay),
    isTradingDay,
    isOpen,
    isClosingWindow,
    allowsNewSignals,
    allowsPriceTracking,
    radarRefreshMs,
    quoteRefreshMs,
    nextActionAt: nextActionAt(parts, phase, isTradingDay),
    note: sessionNote(phase, isTradingDay),
  }
}

export function getLatestCompletedChinaTradeDate(now = new Date()) {
  const session = getChinaMarketSession(now)
  const parts = chinaDateParts(now)
  const minutes = parts.hour * 60 + parts.minute
  if (session.isTradingDay && session.phase === "closed" && minutes >= DAILY_BAR_READY_AFTER) {
    return session.tradeDate
  }
  return previousChinaWeekday(session.tradeDate)
}

export function shouldRunRadarScan(session = getChinaMarketSession()) {
  return session.isTradingDay && session.allowsNewSignals
}

export function shouldTrackRadarPrices(session = getChinaMarketSession()) {
  return session.isTradingDay && session.allowsPriceTracking
}

function chinaDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const hour = Number(parts.hour === "24" ? "0" : parts.hour)
  const minute = Number(parts.minute)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    second: Number(parts.second) || 0,
    weekday: weekdayNumber(parts.weekday),
  }
}

function weekdayNumber(value?: string) {
  switch (value) {
    case "Mon":
      return 1
    case "Tue":
      return 2
    case "Wed":
      return 3
    case "Thu":
      return 4
    case "Fri":
      return 5
    case "Sat":
      return 6
    case "Sun":
      return 7
    default:
      return 0
  }
}

function previousChinaWeekday(dateText: string) {
  const current = new Date(`${dateText}T00:00:00+08:00`)
  current.setUTCDate(current.getUTCDate() - 1)
  for (let i = 0; i < 7; i++) {
    const parts = chinaDateParts(current)
    if (parts.weekday >= 1 && parts.weekday <= 5) return parts.date
    current.setUTCDate(current.getUTCDate() - 1)
  }
  return dateText
}

function phaseLabel(phase: ChinaMarketPhase, isTradingDay: boolean) {
  if (!isTradingDay) return "非交易日"
  if (phase === "pre-open") return "开盘前"
  if (phase === "morning") return "早盘交易中"
  if (phase === "lunch") return "午间休市"
  if (phase === "afternoon") return "午盘交易中"
  if (phase === "post-close") return "收盘结算"
  return "休市"
}

function sessionNote(phase: ChinaMarketPhase, isTradingDay: boolean) {
  if (!isTradingDay) return "周末按休市处理，雷达不新增触发，只保留历史账本。"
  if (phase === "morning" || phase === "afternoon") return "交易时段内：雷达每 5 分钟扫描新机会，已触发信号约 2 分钟跟踪一次现价。"
  if (phase === "post-close") return "收盘后只做最后价格跟踪，不新增推荐。"
  if (phase === "lunch") return "午间休市冻结新触发，可等待下午开盘后继续扫描。"
  return "非连续竞价时段冻结新触发，避免把静态快照误判为刚触发。"
}

function nextActionAt(
  parts: ReturnType<typeof chinaDateParts>,
  phase: ChinaMarketPhase,
  isTradingDay: boolean,
) {
  if (!isTradingDay) return undefined
  if (phase === "pre-open") return `${parts.date}T09:30:00+08:00`
  if (phase === "lunch") return `${parts.date}T13:00:00+08:00`
  if (phase === "post-close" || phase === "closed") return undefined
  return undefined
}
