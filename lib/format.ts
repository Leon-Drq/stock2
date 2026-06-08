/** Format helpers for the editorial layout. */

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
export const CHINA_TIME_ZONE = "Asia/Shanghai"
export const CHINA_TIME_LABEL = "北京时间"

export function formatReportDate(iso: string) {
  const d = new Date(iso)
  const parts = chinaParts(d)
  const yyyy = parts.year ?? "0000"
  const mm = parts.month ?? "00"
  const dd = parts.day ?? "00"
  const hh = parts.hour ?? "00"
  const min = parts.minute ?? "00"
  return {
    date: `${yyyy}.${mm}.${dd}`,
    time: `${hh}:${min}`,
    weekday: WEEKDAYS[Number(parts.weekdayIndex ?? 0)],
  }
}

export function formatChinaDateTime(
  value: string | Date | null | undefined,
  opts: { seconds?: boolean; dateStyle?: "slash" | "short" } = {},
) {
  if (!value) return "N/A"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  const parts = chinaParts(date)
  const year = parts.year ?? "0000"
  const month = parts.month ?? "00"
  const day = parts.day ?? "00"
  const hour = parts.hour ?? "00"
  const minute = parts.minute ?? "00"
  const second = parts.second ?? "00"
  const dateText = opts.dateStyle === "short"
    ? `${month}/${day}`
    : `${year}/${Number(month)}/${Number(day)}`
  return opts.seconds ? `${dateText} ${hour}:${minute}:${second}` : `${dateText} ${hour}:${minute}`
}

export function formatChinaDate(value: string | Date | null | undefined = new Date()) {
  if (!value) return "N/A"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  const parts = chinaParts(date)
  return `${parts.year ?? "0000"}-${parts.month ?? "00"}-${parts.day ?? "00"}`
}

export function formatChinaTime(value: string | Date | null | undefined, seconds = true) {
  if (!value) return "N/A"
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  const parts = chinaParts(date)
  return seconds
    ? `${parts.hour ?? "00"}:${parts.minute ?? "00"}:${parts.second ?? "00"}`
    : `${parts.hour ?? "00"}:${parts.minute ?? "00"}`
}

export function formatBeijingDateTime(
  value: string | Date | null | undefined,
  opts: { seconds?: boolean; dateStyle?: "slash" | "short" } = {},
) {
  const formatted = formatChinaDateTime(value, opts)
  return formatted === "N/A" ? formatted : `${CHINA_TIME_LABEL} ${formatted}`
}

export function formatBeijingTime(value: string | Date | null | undefined, seconds = true) {
  const formatted = formatChinaTime(value, seconds)
  return formatted === "N/A" ? formatted : `${CHINA_TIME_LABEL} ${formatted}`
}

export function formatPrice(n: number) {
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  })
}

export function formatPercent(n: number) {
  return `${n.toFixed(2)}%`
}

function chinaParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value])) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>
  return {
    ...parts,
    hour: parts.hour === "24" ? "00" : parts.hour,
    weekdayIndex: weekdayIndex(parts.weekday),
  }
}

function weekdayIndex(value?: string) {
  if (value === "Mon") return 1
  if (value === "Tue") return 2
  if (value === "Wed") return 3
  if (value === "Thu") return 4
  if (value === "Fri") return 5
  if (value === "Sat") return 6
  return 0
}
