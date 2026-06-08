"use client"

import { Suspense } from "react"
import { BacktestDashboard } from "@/components/backtest/backtest-dashboard"
import type { BacktestDashboardProps } from "@/components/backtest/backtest-dashboard"

export function BacktestDashboardShell(props: BacktestDashboardProps) {
  return (
    <Suspense fallback={<BacktestDashboardSkeleton />}>
      <BacktestDashboard {...props} />
    </Suspense>
  )
}

function BacktestDashboardSkeleton() {
  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="h-4 w-48 rounded bg-[#ededeb]" />
        <div className="mt-3 h-7 w-72 max-w-full rounded bg-[#ededeb]" />
        <div className="mt-3 h-4 w-full max-w-[720px] rounded bg-[#ededeb]" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <div className="h-3 w-16 rounded bg-[#ededeb]" />
              <div className="mt-3 h-5 w-10 rounded bg-[#ededeb]" />
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-5 2xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
          <div className="h-4 w-24 rounded bg-[#ededeb]" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-10 rounded-[7px] border border-rule bg-[#fafafa]" />
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
            <div className="h-4 w-24 rounded bg-[#ededeb]" />
            <div className="mt-4 h-[280px] rounded-[7px] bg-[#f1f4f5]" />
          </div>
          <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
            <div className="h-4 w-28 rounded bg-[#ededeb]" />
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-20 rounded-[7px] border border-rule bg-[#fafafa]" />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
