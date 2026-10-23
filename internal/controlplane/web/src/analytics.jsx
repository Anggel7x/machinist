import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Card } from "@/components/ui/card";
import { PageHeading, QuietState } from "@/components/ui/page-heading";
import { analyticsState } from "@/analytics-state";
import { formatDurationMillis, formatReportingCoverage, formatSuccessRate, formatTokenUsage, tokenUsageSummary, usageBreakdown } from "@/run-metrics";

export function Analytics({ jobs, loaded, error }) {
  const [days, setDays] = useState("30");
  const view = useMemo(() => analyticsState({ jobs, days, loaded, error }), [days, error, jobs, loaded]);
  const runs = view.runs || [];
  const usage = useMemo(() => tokenUsageSummary(runs), [runs]);
  const tasks = view.metrics?.tasks || [];
  const byRepository = useMemo(() => usageBreakdown(tasks, "repository", "command"), [tasks]);
  const byCommand = useMemo(() => usageBreakdown(tasks, "command"), [tasks]);

  return <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
    <PageHeading title="Task analytics" description="Task outcomes with measured run duration and executor-reported token usage.">
      <label className="w-full sm:w-40"><span className="field-label">Time window</span><select className="field-control" value={days} onChange={(event) => setDays(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
    </PageHeading>

    {view.kind === "error" ? <div role="alert" className="alert">{view.message}</div> : view.kind === "loading" ? <Card><QuietState title="Measuring the work" description="Loading task outcomes and reported usage." role="status" /></Card> : <>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" aria-label="Task metrics">
        <Card className="flex min-h-48 flex-col justify-between border-foreground bg-foreground p-5 text-background sm:p-6">
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-background/60">Average task time</p><p className="mt-3 break-words text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{formatDurationMillis(view.metrics.averageTaskDurationMillis)}</p></div>
          <p className="mt-6 text-sm text-background/70">{view.metrics.contributingTasks} contributing task{view.metrics.contributingTasks === 1 ? "" : "s"} with complete run timing</p>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Metric label="Total tasks" value={view.metrics.totalTasks} />
          <Metric label="Success rate" value={formatSuccessRate(view.metrics.successRate)} />
          <Metric label="Failed tasks" value={view.metrics.failedTasks} />
          <Metric label="Active tasks" value={view.metrics.activeTasks} />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="min-w-0 p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total reported tokens</p><p className="mt-2 break-all text-2xl font-semibold tabular-nums">{formatTokenUsage(usage.total)}</p><p className="mt-1 text-xs text-muted-foreground">Input plus output tokens reported in this window.</p></Card>
        <Card className="p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reporting coverage</p><p className="mt-2 text-2xl font-semibold tabular-nums">{formatReportingCoverage(usage)}</p><p className="mt-1 text-xs text-muted-foreground">{usage.unavailable ? `${usage.unavailable} completed ${usage.unavailable === 1 ? "run has" : "runs have"} unavailable usage.` : usage.completed ? "Every completed run reported usage." : "No completed runs in this window."}</p></Card>
      </div>

      <div className="space-y-6">
        <Breakdown id="repository-breakdown" title="By repository" rows={byRepository} />
        <Breakdown id="command-breakdown" title="By command" rows={byCommand} />
      </div>

      <section aria-labelledby="completed-run-metrics">
        <div className="mb-3"><h2 id="completed-run-metrics" className="text-sm font-semibold">Completed run metrics</h2><p className="mt-1 text-xs text-muted-foreground">Duration and reported token usage for runs belonging to tasks in this window.</p></div>
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_10rem_12rem] gap-4 border-b border-border bg-muted/35 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Run</span><span>Command</span><span>Duration</span><span>Reported token usage</span>
          </div>
          {runs.length ? runs.map((run) => <div key={run.id} className="grid gap-2 border-b border-border px-4 py-3.5 last:border-b-0 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_10rem_12rem] sm:items-center sm:gap-4">
            <p className="truncate font-mono text-xs text-muted-foreground">{shortId(run.id)}</p>
            <p className="truncate text-sm font-medium capitalize">{run.command}</p>
            <p className="text-sm tabular-nums"><span className="sm:hidden text-muted-foreground">Duration · </span>{formatDurationMillis(run.duration_millis)}</p>
            <p className="min-w-0 break-all text-sm tabular-nums"><span className="sm:hidden text-muted-foreground">Reported tokens · </span>{formatTokenUsage(run.token_usage)}</p>
          </div>) : <div className="grid place-items-center p-12 text-sm text-muted-foreground">No completed runs in this window.</div>}
        </Card>
      </section>
    </>}
  </div>;
}

function Breakdown({ id, title, rows }) {
  return <section aria-labelledby={id} className="min-w-0">
    <div className="mb-3"><h2 id={id} className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">Average time of finished tasks, with total run time and reported token usage of completed runs.</p></div>
    <Card className="overflow-hidden">
      <div className={`hidden gap-4 border-b border-border bg-muted/35 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid ${breakdownColumns}`}>
        <span>Name</span><span className="text-right">Tasks</span><span className="text-right">Avg task</span><span className="text-right">Run time</span><span className="text-right">Reported tokens</span>
      </div>
      {rows.length ? rows.map((row) => <div key={row.name} className="border-b border-border last:border-b-0">
        <BreakdownRow row={row} />
        {row.children?.map((child) => <BreakdownRow key={child.name} row={child} nested />)}
      </div>) : <div className="grid place-items-center p-12 text-sm text-muted-foreground">No tasks in this window.</div>}
    </Card>
  </section>;
}

const breakdownColumns = "sm:grid-cols-[minmax(8rem,1fr)_4rem_7rem_8rem_minmax(9rem,11rem)]";

function BreakdownRow({ row, nested = false }) {
  return <div className={`grid gap-1 px-4 sm:items-center sm:gap-4 ${breakdownColumns} ${nested ? "py-2 text-muted-foreground" : "py-3"}`}>
    <p className={`truncate font-mono text-sm ${nested ? "pl-4" : "font-medium text-foreground"}`} title={row.name}>{nested ? "↳ " : ""}{row.name}</p>
    <p className="text-sm tabular-nums sm:text-right"><span className="sm:hidden text-muted-foreground">Tasks · </span>{row.tasks}</p>
    <p className="text-sm tabular-nums sm:text-right" title={`${row.contributingTasks} finished task${row.contributingTasks === 1 ? "" : "s"} with complete run timing`}><span className="sm:hidden text-muted-foreground">Avg task · </span>{row.averageTaskDurationMillis === null ? "No finished tasks" : formatDurationMillis(row.averageTaskDurationMillis)}</p>
    <p className="text-sm tabular-nums sm:text-right"><span className="sm:hidden text-muted-foreground">Run time · </span>{row.durationMillis === null ? "No completed runs" : formatDurationMillis(row.durationMillis)}</p>
    <div className="min-w-0 sm:text-right"><p className="break-all text-sm tabular-nums"><span className="sm:hidden text-muted-foreground">Reported tokens · </span>{row.usage.total === undefined ? "Not reported" : formatTokenUsage(row.usage.total)}</p><p className="text-xs text-muted-foreground">{row.usage.completed ? `${row.usage.reported} of ${row.usage.completed} runs reported` : "No completed runs"}</p></div>
  </div>;
}

function Metric({ label, value }) { return <Card className="min-w-0 p-4 sm:p-5"><p className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</p><p className="mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-3xl">{typeof value === "number" ? <AnimatedNumber value={value} duration={0.6} /> : value}</p></Card>; }
function shortId(id) { const [, value = id] = id.split("_", 2); return value.slice(0, 8); }
