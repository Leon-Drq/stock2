import { PageShell } from "@/components/shared/page-shell"

export default function Loading() {
  return (
    <PageShell width="wide">
      <section className="overflow-hidden rounded-[7px] border border-rule bg-white">
        <div className="h-14 border-b border-rule bg-[#fafafa]" />
        <div className="px-4 py-7 md:px-5 md:py-9">
          <div className="h-3 w-36 rounded-full bg-[#f0f0ef]" />
          <div className="mt-4 h-10 w-64 rounded-[7px] bg-[#eeeeed]" />
          <div className="mt-3 h-4 max-w-[720px] rounded-full bg-[#f3f3f2]" />
        </div>
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white p-4 md:p-5">
        <div className="h-4 w-32 rounded-full bg-[#f0f0ef]" />
        <div className="mt-4 grid gap-2">
          <div className="h-16 rounded-[7px] bg-[#f7f7f6]" />
          <div className="h-16 rounded-[7px] bg-[#f7f7f6]" />
          <div className="h-16 rounded-[7px] bg-[#f7f7f6]" />
        </div>
      </section>
    </PageShell>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
      <div className="h-3 w-24 rounded-full bg-[#f0f0ef]" />
      <div className="mt-4 h-7 w-20 rounded-[7px] bg-[#eeeeed]" />
      <div className="mt-3 h-3 w-full rounded-full bg-[#f3f3f2]" />
    </div>
  )
}
