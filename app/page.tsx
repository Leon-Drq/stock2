import { Suspense } from "react"
import { ArchitectureIndex } from "@/components/home/architecture-index"
import { HomeMasthead } from "@/components/home/home-masthead"
import { RuntimeReadiness, RuntimeReadinessFallback } from "@/components/home/runtime-readiness"
import { TodayOpportunities, TodayOpportunitiesFallback } from "@/components/home/today-opportunities"
import { TodaySnapshot, TodaySnapshotFallback } from "@/components/home/today-snapshot"
import { PageShell } from "@/components/shared/page-shell"

export const dynamic = "force-dynamic"

export default function HomePage() {
  return (
    <PageShell width="wide">
      <HomeMasthead />
      <Suspense fallback={<TodayOpportunitiesFallback />}>
        <TodayOpportunities />
      </Suspense>
      <Suspense fallback={<RuntimeReadinessFallback />}>
        <RuntimeReadiness />
      </Suspense>
      <Suspense fallback={<TodaySnapshotFallback />}>
        <TodaySnapshot />
      </Suspense>
      <ArchitectureIndex />
    </PageShell>
  )
}
