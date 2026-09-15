# Configuration

Commands use an executor, optional prompt template, and timeout:

```toml
[commands.audit]
executor = "codex"
prompt_file = "prompts/audit.md"
timeout = "30m"

[commands.custom-workflow]
executor = "custom-workflow-script"
timeout = "2h"
```

Without `prompt_file`, the input prompt is sent unchanged. With a template, include
`{{machinist.prompt}}`. Executors and repositories remain worker-owned:

```toml
[executors.custom-workflow-script]
command = ["./scripts/custom-workflow.sh"]

[repositories.my-project]
path = "/absolute/path/to/my-project"
```

Managed triggers select one command with `command = "audit"`. Model selection remains
available when the executor command includes `{{machinist.model}}`.

## Repositories

Register each repository with the control plane. `slug` is where it lives on GitHub, and
`parallel` is its ceiling: how many of its runs may be in flight at once, across every
host.

```toml
[repositories.my-project]
slug = "owner/my-project"
parallel = 3
```

`machinist repo add owner/my-project --parallel 3` writes that block and validates the
result. A repository with no `parallel` is bounded only by the control plane's
`max_concurrent_jobs` under `[server]`; both limits apply, and the ceiling is enforced
when a run is leased, so a hand-started worker is subject to it too.

The older `[github.repositories]` name-to-slug map is still read, so existing
configurations keep working. A name declared in both with different slugs is rejected.

## Workers per machine

`max_workers` in `worker.toml` is how many workers the machine will run. `machinist
worker start` starts them all and keeps them alive; with the default of one it behaves
exactly as it always has, under the same name.

```toml
max_workers = 2
```

Each worker gets its own detached Git worktree under the worker data directory, reset to
the checkout's head before every run, so several workers never share one index. A
`[repositories.NAME]` entry with no `path` means the machine is willing to serve that
repository and will clone it on first dispatch; an explicit `path` always wins.

## Migration

The `agents` table was renamed to `commands`. Move `[agents.NAME]` to `[commands.NAME]`
and replace `--agent` with `--command`.

The pipeline feature was removed. Replace a sequential pipeline with one executable script,
configure that script as an approved worker executor, and expose it through one command.
Legacy `[pipelines]` configuration fails with migration guidance. Pre-command databases are
recreated once because this release intentionally consolidates the schema before active use.
