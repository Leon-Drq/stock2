import { redirect } from "next/navigation"

export const metadata = {
  title: "策略矿工 — Stock Radar",
}

export default function StrategyMinerRedirectPage() {
  redirect("/strategy-research?tab=miner")
}
