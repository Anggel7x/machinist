import { useState } from "react";
import { Clock3, GitBranch, Plus, TimerReset, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeading, QuietState } from "@/components/ui/page-heading";
import { cn } from "@/lib/utils";
import { defaultTriggerName, githubTriggerRegistration, subjects, triggerDescription } from "@/trigger-form";
import { triggerHealthTone, triggerView } from "@/trigger-state";

export function TriggersPage({ triggers = [], definitions = [], repositories = [], commands = [], csrfToken, loaded, error, onRegistered }) {
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const byIdentity = new Map(definitions.map((definition) => [definition.identity, definition]));
  const action = !adding && <Button className="text-xs!" disabled={!repositories.length} title={repositories.length ? undefined : "Register a repository first"} onClick={() => { setNotice(""); setAdding(true); }}><Plus className="size-4" />Add trigger</Button>;
  return <Page title="Triggers" action={action}>
    {adding && <TriggerForm repositories={repositories} commands={commands} csrfToken={csrfToken} close={() => setAdding(false)} registered={async (trigger) => { setAdding(false); setNotice(`Registered github/${trigger.name}.`); await onRegistered(); }} />}
    {notice && <div role="status" className="alert">{notice}</div>}
    {error && <Failure value={error} />}
    {!loaded && !error ? <Loading /> : loaded && (triggers.length ? <div className="grid gap-4 xl:grid-cols-2">{triggers.map((trigger) => <TriggerCard key={trigger.identity} trigger={trigger} definition={byIdentity.get(trigger.identity)} />)}</div> : <Empty />)}
  </Page>;
}

function TriggerForm({ repositories, commands, csrfToken, close, registered }) {
  const [input, setInput] = useState({ repository: repositories[0] || "", on: "issue", label: "", command: commands[0] || "", prompt: "", every: "", model: "", name: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const set = (field) => (event) => setInput((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    const registration = githubTriggerRegistration(input);
    if (registration.error) {
      setError(registration.error);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Machinist-CSRF": csrfToken },
        body: JSON.stringify(registration.body),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Registration failed (${response.status})`);
      await registered(body);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const optional = <span className="font-normal normal-case tracking-normal text-muted-foreground">optional</span>;
  return <Card className="overflow-hidden border-foreground/20">
    <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
      <h2 className="text-sm font-semibold">Add GitHub trigger</h2>
      <Button variant="ghost" size="icon" onClick={close} aria-label="Close add trigger form"><X className="size-4" /></Button>
    </div>
    <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="field-label">Repository</span><select className="field-control font-mono" value={input.repository} onChange={set("repository")} required>{repositories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label><span className="field-label">Starts when</span><select className="field-control" value={input.on} onChange={set("on")}>{subjects.map((subject) => <option key={subject.value} value={subject.value}>{subject.label}</option>)}</select></label>
        <label><span className="field-label">Label</span><input className="field-control font-mono" value={input.label} onChange={set("label")} placeholder={input.on === "pull_request" ? "machinist:shepherd" : "machinist:requested"} maxLength={50} required /></label>
        <label><span className="field-label">Run with</span><select className="field-control" value={input.command} onChange={set("command")} required>{commands.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      </div>
      <label className="block"><span className="field-label">Prompt {optional}</span><textarea className="field-control min-h-20 resize-y" value={input.prompt} onChange={set("prompt")} placeholder="Run the Shepherd queue with max_actions=8, limited to the pull request below." /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label><span className="field-label">Poll every {optional}</span><input className="field-control font-mono" value={input.every} onChange={set("every")} placeholder="1m" /></label>
        <label><span className="field-label">Model {optional}</span><input className="field-control font-mono" value={input.model} onChange={set("model")} maxLength={128} /></label>
        <label><span className="field-label">Name {optional}</span><input className="field-control font-mono" value={input.name} onChange={set("name")} placeholder={defaultTriggerName(input) || "derived"} /></label>
      </div>
      {error && <div role="alert" className="alert">{error}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">The labelled {input.on === "pull_request" ? "pull request" : "issue"}'s URL follows the prompt, or the job gets "Complete &lt;url&gt;" without one. Saved to config.toml and applied at once.</p><Button disabled={submitting || !input.repository || !input.command || !input.label.trim()}>{submitting ? "Registering…" : "Register trigger"}</Button></div>
    </form>
  </Card>;
}

function TriggerCard({ trigger, definition }) {
  const view = triggerView(trigger);
  const tone = triggerHealthTone(view.health);
  const healthClass = {
    success: "border-border text-muted-foreground",
    warning: "border-dashed border-foreground/40 text-foreground",
    danger: "border-foreground bg-foreground text-background",
    neutral: "border-dashed border-border text-muted-foreground",
  }[tone];
  return <Card className={cn("overflow-hidden", tone === "danger" && "border-foreground/40")}>
    <header className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0"><div className="flex items-center gap-2"><TimerReset className="size-4 shrink-0 text-muted-foreground" /><h2 className="truncate font-mono text-sm font-semibold" title={view.identity}>{view.identity}</h2></div><p className="mt-1 text-xs text-muted-foreground">{definition ? triggerDescription(definition) : <span className="capitalize">{view.family} trigger</span>}</p></div>
      <Badge className={cn("shrink-0 gap-1.5 capitalize", healthClass)}><span className="size-1.5 rounded-full bg-current" />{view.health}</Badge>
    </header>
    <dl className="grid gap-x-6 gap-y-3 p-4 text-xs sm:grid-cols-2 sm:p-5">{view.rows.map((row) => <div key={row.field} className="min-w-0"><dt className="text-muted-foreground">{row.label}</dt><dd className={cn("mt-1 break-all font-medium", row.field.endsWith("_count") && "tabular-nums", row.field.includes("due") || row.field.includes("attempt") || row.field.includes("success") ? "font-mono" : "")}><TriggerValue field={row.field} value={row.value} /></dd></div>)}</dl>
    {view.error && <div role="alert" className="flex items-start gap-2 border-t border-border bg-muted px-4 py-3 text-xs text-foreground sm:px-5"><GitBranch className="mt-0.5 size-3.5 shrink-0" /><p className="break-words">{view.error}</p></div>}
  </Card>;
}

function TriggerValue({ field, value }) {
  if ((field === "next_due" || field === "last_attempt" || field === "last_success") && value !== "Not yet") return <time dateTime={value} title={formatDate(value)}>{formatDate(value)}</time>;
  if (field === "active_job" && value !== "None") return <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-muted-foreground" />{value}</span>;
  return value;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function Page({ title, action, children }) { return <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8"><PageHeading title={title} description="Scheduled and managed ways work enters the shop.">{action}</PageHeading>{children}</div>; }
function Loading() { return <Card><QuietState title="Checking the schedule" description="Loading managed trigger state." role="status" /></Card>; }
function Failure({ value }) { return <div role="alert" className="alert">{value}</div>; }
function Empty() { return <Card><QuietState title="No managed triggers" description="Configured schedules and event sources will appear here." /></Card>; }
