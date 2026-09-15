# Architecture

Machinist owns process execution, not orchestration.

- `config.toml` defines portable named commands, optional prompt templates, timeouts,
  triggers, registered repositories, and server settings.
- `worker.toml` defines approved executor argument arrays, logical repository paths, and
  how many workers the machine will run.
- `internal/runner` starts one process in one repository, writes the prompt to stdin,
  streams both output channels, records artifacts and token usage, and terminates the
  process tree on timeout or cancellation.
- `internal/controlplane` stores one job and one run, leases it to a capable worker,
  rejects stale completions, mirrors each registered repository's GitHub state, and
  exposes authenticated APIs and the web UI.
- `internal/managedworker` resolves only worker-owned executor and repository names.
- `internal/cli` supervises this machine's workers when it runs more than one.

Each job has exactly one run. The database enforces this with a unique `runs.job_id`.
Terminal state comes only from the process result. There is no internal stage model.

## Where limits are decided

A repository's ceiling — how much of its work may be in flight at once — is control-plane
policy, enforced when a run is leased, so no worker can route around it. How many workers
a machine runs is the machine's own capability, declared in its `worker.toml`. Workers are
not bound to a repository: any worker takes whatever work its host is registered for, and
the ceilings shape the result centrally.

One worker holds at most one lease. Parallelism is therefore more worker processes, not
concurrent work inside one, which keeps that invariant intact and confines a wedged
coding agent to one worker. Each worker executes in its own detached Git worktree, reset
to the checkout's head before every run.

## GitHub

The control plane reads GitHub and never writes to it beyond the intake labels it has
always managed. It mirrors pull requests and issues for every registered repository on
the scheduler tick and serves snapshots from that mirror, so the dashboard never waits on
GitHub. Whether a pull request may merge is decided by the repository's own policy
workflow; machinist reports the outcome and holds no opinion about it.
