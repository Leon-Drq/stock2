"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, LogIn, LogOut, Play, RefreshCw, Save, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type User = {
  id: string
  email: string
  role: "admin" | "user"
}

type CronJob = {
  id: string
  name: string
  target_path: string
  cron_expr: string
  enabled: boolean
  run_on_enable: boolean
  timeout_seconds: number
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
}

type Drafts = Record<string, Pick<CronJob, "cron_expr" | "enabled" | "run_on_enable">>

export function CronControlPanel() {
  const [user, setUser] = useState<User | null>(null)
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [drafts, setDrafts] = useState<Drafts>({})
  const [email, setEmail] = useState("admin@example.com")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  const enabledCount = useMemo(() => jobs.filter((job) => job.enabled).length, [jobs])

  useEffect(() => {
    void loadSession()
  }, [])

  async function loadSession() {
    setLoading(true)
    setMessage("")
    const response = await fetch("/api/control/auth/session", { cache: "no-store" })
    if (response.ok) {
      const payload = await response.json() as { user: User }
      setUser(payload.user)
      await loadJobs()
    } else {
      setUser(null)
      setJobs([])
      setDrafts({})
    }
    setLoading(false)
  }

  async function loadJobs() {
    const response = await fetch("/api/control/cron/jobs", { cache: "no-store" })
    if (!response.ok) {
      setMessage(await errorMessage(response, "读取任务失败"))
      return
    }
    const payload = await response.json() as { jobs: CronJob[] }
    setJobs(payload.jobs)
    setDrafts(Object.fromEntries(payload.jobs.map((job) => [job.id, {
      cron_expr: job.cron_expr,
      enabled: job.enabled,
      run_on_enable: job.run_on_enable,
    }])))
  }

  async function login() {
    setLoading(true)
    setMessage("")
    const response = await fetch("/api/control/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      setMessage(await errorMessage(response, "登录失败"))
      setLoading(false)
      return
    }
    const payload = await response.json() as { user: User }
    setUser(payload.user)
    await loadJobs()
    setPassword("")
    setLoading(false)
  }

  async function logout() {
    setLoading(true)
    await fetch("/api/control/auth/logout", { method: "POST" })
    setUser(null)
    setJobs([])
    setDrafts({})
    setLoading(false)
  }

  async function saveJob(job: CronJob) {
    const draft = drafts[job.id]
    if (!draft) return
    setSavingId(job.id)
    setMessage("")
    const response = await fetch(`/api/control/cron/jobs/${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    })
    if (!response.ok) {
      setMessage(await errorMessage(response, "保存失败"))
    } else {
      await loadJobs()
      setMessage("配置已保存")
    }
    setSavingId(null)
  }

  async function runJob(job: CronJob) {
    setSavingId(job.id)
    setMessage("")
    const response = await fetch(`/api/control/cron/jobs/${encodeURIComponent(job.id)}/run`, { method: "POST" })
    if (!response.ok) {
      setMessage(await errorMessage(response, "启动执行失败"))
    } else {
      setMessage(`${job.name} 已加入执行队列`)
    }
    setSavingId(null)
  }

  function updateDraft(jobId: string, patch: Partial<Drafts[string]>) {
    setDrafts((current) => ({
      ...current,
      [jobId]: {
        ...current[jobId],
        ...patch,
      },
    }))
  }

  if (loading) {
    return (
      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-10 text-center text-sm text-ink-muted">
        <Loader2 className="mx-auto mb-3 size-5 animate-spin" aria-hidden />
        读取调度配置...
      </section>
    )
  }

  if (!user) {
    return (
      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-5 md:px-5">
        <div className="max-w-[520px]">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ShieldCheck className="size-4" aria-hidden />
            Admin session
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">管理员登录</h2>
          <div className="mt-4 grid gap-3">
            <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" />
            <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="password" type="password" />
            <Button className="w-fit" onClick={login} disabled={!email || !password}>
              <LogIn className="size-4" aria-hidden />
              登录
            </Button>
          </div>
          {message && <p className="mt-3 text-sm text-[#9f2d20]">{message}</p>}
        </div>
      </section>
    )
  }

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white">
      <div className="flex flex-col gap-3 border-b border-rule px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <ShieldCheck className="size-4" aria-hidden />
            {user.email}
          </div>
          <h2 className="mt-1 text-[20px] font-semibold text-ink">APScheduler 任务</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{enabledCount} enabled</Badge>
          <Button variant="outline" size="sm" onClick={loadJobs}>
            <RefreshCw className="size-4" aria-hidden />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="size-4" aria-hidden />
            注销
          </Button>
        </div>
      </div>

      {message && <div className="border-b border-rule-soft px-4 py-3 text-sm text-ink-muted md:px-5">{message}</div>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4 md:px-5">任务</TableHead>
            <TableHead>cron</TableHead>
            <TableHead>启用</TableHead>
            <TableHead>启用后立即执行</TableHead>
            <TableHead>上次状态</TableHead>
            <TableHead className="text-right pr-4 md:pr-5">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const draft = drafts[job.id] ?? job
            const saving = savingId === job.id
            return (
              <TableRow key={job.id}>
                <TableCell className="px-4 md:px-5">
                  <div className="font-medium text-ink">{job.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-ink-muted">{job.target_path}</div>
                </TableCell>
                <TableCell>
                  <Input
                    className="min-w-[220px] font-mono text-xs"
                    value={draft.cron_expr}
                    onChange={(event) => updateDraft(job.id, { cron_expr: event.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Switch checked={draft.enabled} onCheckedChange={(enabled) => updateDraft(job.id, { enabled })} />
                </TableCell>
                <TableCell>
                  <Switch checked={draft.run_on_enable} onCheckedChange={(run_on_enable) => updateDraft(job.id, { run_on_enable })} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={job.last_status} />
                  <div className="mt-1 max-w-[220px] truncate text-[11px] text-ink-muted">
                    {job.last_error || formatTime(job.last_run_at)}
                  </div>
                </TableCell>
                <TableCell className="pr-4 text-right md:pr-5">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => runJob(job)} disabled={saving}>
                      <Play className="size-4" aria-hidden />
                      执行
                    </Button>
                    <Button size="sm" onClick={() => saveJob(job)} disabled={saving}>
                      {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                      保存
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">never</Badge>
  if (status === "success") return <Badge className="bg-health-ok text-white">success</Badge>
  return <Badge variant="destructive">{status}</Badge>
}

function formatTime(value: string | null) {
  if (!value) return "尚未执行"
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail ?? fallback
  } catch {
    return fallback
  }
}
