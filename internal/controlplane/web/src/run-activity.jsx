import { useEffect, useMemo, useState } from "react";
import { FileDiff as FileDiffIcon } from "lucide-react";
import { FileDiff } from "@/components/agents/file-diff";
import { TodoList } from "@/components/agents/todo-list";
import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result";
import { Button } from "@/components/ui/button";
import { parseTranscript, parseUnifiedDiff } from "@/run-transcript";

const recentTools = 40;
const terminalStates = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

// A run's activity is read once it has finished: the worker delivers the
// transcript with its completion, so there is nothing to read before then.
export function RunActivity({ run }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const finished = terminalStates.has(run.state);
  const response = useJSON(open && finished ? `/api/v1/runs/${encodeURIComponent(run.id)}/transcript` : "");
  const transcript = useMemo(() => response.value ? parseTranscript(response.value.stdout) : null, [response.value]);

  if (!finished) return null;
  if (!open) return <Button variant="ghost" size="sm" className="-ml-3 mt-3 text-xs!" onClick={() => setOpen(true)}>Show agent activity</Button>;

  const tools = transcript?.tools || [];
  const visible = showAll ? tools : tools.slice(-recentTools);
  return <section className="mt-4 space-y-3 border-t border-border pt-3" aria-label={`Agent activity for ${run.id}`}>
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent activity</h4>
      <Button variant="ghost" size="sm" className="h-7 text-xs!" onClick={() => setOpen(false)}>Hide</Button>
    </div>
    {response.error && <div role="alert" className="alert">{response.error}</div>}
    {response.loading && <p className="text-xs text-muted-foreground" role="status">Reading the transcript…</p>}
    {transcript && <>
      {response.value.truncated && <p className="text-xs text-muted-foreground">The worker stopped recording output part way through this run; later activity is missing.</p>}
      {transcript.todos.length > 0 && <TodoList items={transcript.todos} title="Plan" defaultOpen collapseOnComplete={false} />}
      {tools.length ? <div className="min-w-0">
        {tools.length > visible.length && <Button variant="ghost" size="sm" className="-ml-3 h-7 text-xs!" onClick={() => setShowAll(true)}>Show {tools.length - visible.length} earlier tool calls</Button>}
        <ol className="grid min-w-0 gap-0.5">{visible.map((tool) => <li key={tool.id} className="min-w-0"><ToolActivity tool={tool} /></li>)}</ol>
      </div> : <p className="text-xs text-muted-foreground">{transcript.format === "unknown" ? "This executor's output has no structured tool activity to show." : "The agent made no tool calls."}</p>}
    </>}
  </section>;
}

function ToolActivity({ tool }) {
  if (tool.edit) return <FileDiff file={tool.edit.file || tool.title} lines={tool.edit.lines} status="complete" defaultOpen={false} language="text" maxHeight={320} />;
  const meta = tool.exitCode !== undefined && tool.exitCode !== null && tool.exitCode !== 0 ? `exit ${tool.exitCode}` : undefined;
  const body = [tool.input && tool.kind === "terminal" ? `$ ${tool.input}` : tool.input, tool.output].filter(Boolean).join("\n\n");
  return <ToolResult tool={tool.name} title={tool.title} kind={tool.kind} status={tool.status} meta={meta} defaultOpen={false} maxHeight={320} copyText={body || undefined}>
    {body ? <ToolResultOutput language="text">{body}</ToolResultOutput> : <p className="text-xs text-muted-foreground">No output.</p>}
  </ToolResult>;
}

// The end of the run as it landed on GitHub: the pull request's diff, read on
// demand because the mirror deliberately stores only its size.
export function TaskChanges({ job }) {
  const pull = job.pull_request;
  const [open, setOpen] = useState(false);
  const response = useJSON(open && pull ? `/api/v1/jobs/${encodeURIComponent(job.id)}/diff?head=${encodeURIComponent(pull.head_ref_oid || "")}` : "");
  const files = useMemo(() => response.value ? parseUnifiedDiff(response.value.diff) : [], [response.value]);
  if (!pull) return null;

  return <section aria-labelledby="task-changes" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id="task-changes" className="text-sm font-semibold">Changes</h2>
      <span className="font-mono text-xs text-muted-foreground">+{pull.additions} / -{pull.deletions} in {pull.changed_files} file{pull.changed_files === 1 ? "" : "s"}</span>
    </div>
    {!open ? <Button variant="outline" size="sm" className="text-xs!" onClick={() => setOpen(true)}><FileDiffIcon className="size-3.5" />Load diff for pull request #{pull.number}</Button> : <>
      {response.error && <div role="alert" className="alert">{response.error}</div>}
      {response.loading && <p className="text-xs text-muted-foreground" role="status">Reading the diff from GitHub…</p>}
      {response.value?.truncated && <p className="text-xs text-muted-foreground">The diff is too large to show in full; the last files are missing. Open the pull request for the rest.</p>}
      {response.value && (files.length ? <div className="grid min-w-0 gap-1 border-y border-border py-2">
        {files.map((file) => file.binary
          ? <p key={file.file} className="flex min-h-9 items-center gap-2 font-mono text-xs text-muted-foreground"><FileDiffIcon className="size-4 shrink-0" />{file.file} · binary</p>
          : <FileDiff key={file.file} file={file.file} lines={file.lines} status="complete" defaultOpen={files.length <= 3} language="text" maxHeight={420} />)}
      </div> : <p className="text-xs text-muted-foreground">The pull request has no textual changes.</p>)}
    </>}
  </section>;
}

function useJSON(url) {
  const [result, setResult] = useState({ loading: false, error: "", value: null });
  useEffect(() => {
    if (!url) return undefined;
    const controller = new AbortController();
    setResult({ loading: true, error: "", value: null });
    fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      setResult({ loading: false, error: "", value: body });
    }).catch((error) => {
      if (error.name !== "AbortError") setResult({ loading: false, error: error.message, value: null });
    });
    return () => controller.abort();
  }, [url]);
  return result;
}
