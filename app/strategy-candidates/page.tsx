import { redirect } from "next/navigation"

export const metadata = {
  title: "策略候选池 — Stock Radar",
}

export default function StrategyCandidatesRedirectPage() {
  redirect("/strategy-research?tab=candidates")
}
