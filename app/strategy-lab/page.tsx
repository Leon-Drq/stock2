import { redirect } from "next/navigation"

export const metadata = {
  title: "策略实验室 — Stock Radar",
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function StrategyLabRedirectPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {}
  const candidate = firstParam(params, "candidate")
  const target = new URLSearchParams({ tab: "lab" })
  if (candidate) target.set("candidate", candidate)
  redirect(`/strategy-research?${target.toString()}`)
}

function firstParam(params: SearchParams | undefined, key: string) {
  const value = params?.[key]
  return Array.isArray(value) ? value[0] : value
}
