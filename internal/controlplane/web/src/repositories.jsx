import { useState } from "react";
import { ExternalLink, FolderGit2, Layers, Plus, Server, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeading, QuietState } from "@/components/ui/page-heading";
import { repositoryRegistration, repositoryRows } from "@/repositories";

export function RepositoriesPage({ registered, workers, csrfToken, loaded, error, onRegistered }) {
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const rows = repositoryRows(registered, workers);
  return <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
    <PageHeading title="Repositories" description="Codebases the control plane registers, and the workers live to take their work.">
      {!adding && <Button className="text-xs!" onClick={() => { setNotice(""); setAdding(true); }}><Plus className="size-4" />Add repository</Button>}
    </PageHeading>
    {adding && <RepositoryForm csrfToken={csrfToken} close={() => setAdding(false)} registered={async (repository) => { setAdding(false); setNotice(`Registered ${repository.slug} as ${repository.name}.`); await onRegistered(); }} />}
    {notice && <div role="status" className="alert">{notice}</div>}
    {error && <div role="alert" className="alert">{error}</div>}
    {!loaded && !error ? <Card><QuietState title="Preparing the bench" description="Loading registered repositories." role="status" /></Card> : loaded && (rows.length ? <Card className="overflow-hidden">{rows.map((row) => <RepositoryRow key={row.name} row={row} />)}</Card> : <Card><QuietState title="No repositories registered." description="Add a GitHub repository so workers can take its work." /></Card>)}
  </div>;
}

function RepositoryRow({ row }) {
  return <article className="grid gap-3 border-b border-border p-4 last:border-b-0 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center sm:px-5">
    <div className="min-w-0">
      <div className="flex items-center gap-2"><FolderGit2 className="size-4 shrink-0 text-muted-foreground" /><h2 className="truncate font-mono text-sm font-semibold">{row.name}</h2></div>
      {row.registered
        ? <a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground" href={`https://github.com/${row.slug}`} target="_blank" rel="noreferrer">{row.slug}<ExternalLink className="size-3 shrink-0" /></a>
        : <p className="mt-1 text-xs text-muted-foreground">Listed in a worker.toml but not registered, so GitHub triggers and outcomes skip it.</p>}
    </div>
    <div className="flex flex-wrap gap-1.5 sm:justify-end">
      {!row.registered && <Badge className="border-dashed border-foreground/40 text-foreground">Not registered</Badge>}
      {row.registered && <Badge className="border-border bg-muted text-muted-foreground"><Layers className="mr-1 size-3" />{row.parallel ? `${row.parallel} parallel` : "No parallel limit"}</Badge>}
      <Badge className={row.workers ? "border-foreground/30 text-foreground" : "border-dashed border-border text-muted-foreground"}><Server className="mr-1 size-3" />{row.workers ? `${row.workers} worker${row.workers === 1 ? "" : "s"} live` : "No live worker"}</Badge>
    </div>
  </article>;
}

function RepositoryForm({ csrfToken, close, registered }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [parallel, setParallel] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const preview = repositoryRegistration({ slug, name: "", parallel: "" });

  async function submit(event) {
    event.preventDefault();
    const registration = repositoryRegistration({ slug, name, parallel });
    if (registration.error) {
      setError(registration.error);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/repositories", {
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

  return <Card className="overflow-hidden border-foreground/20">
    <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
      <h2 className="text-sm font-semibold">Add repository</h2>
      <Button variant="ghost" size="icon" onClick={close} aria-label="Close add repository form"><X className="size-4" /></Button>
    </div>
    <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
      <label className="block"><span className="field-label">GitHub repository</span><input className="field-control font-mono" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="owner/name or https://github.com/owner/name" autoFocus required /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="field-label">Name <span className="font-normal normal-case tracking-normal text-muted-foreground">optional</span></span><input className="field-control font-mono" value={name} onChange={(event) => setName(event.target.value)} placeholder={preview.derived || "derived from the repository"} maxLength={100} /></label>
        <label><span className="field-label">Parallel runs <span className="font-normal normal-case tracking-normal text-muted-foreground">optional</span></span><input className="field-control font-mono" type="number" min="1" step="1" value={parallel} onChange={(event) => setParallel(event.target.value)} placeholder="No limit" /></label>
      </div>
      {error && <div role="alert" className="alert">{error}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Saved to config.toml and applied at once. Workers clone it on their first run.</p><Button disabled={submitting || !slug.trim()}>{submitting ? "Registering…" : "Register repository"}</Button></div>
    </form>
  </Card>;
}
